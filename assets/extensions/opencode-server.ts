import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { Model, Context, SimpleStreamOptions, AssistantMessageEventStream } from '@earendil-works/pi-ai';
// Cliente HTTP puro contra un OpenCode Server que ya está corriendo.
// NO usamos createOpencode: ese hace cross-spawn de "opencode serve" en
// puerto 4096 por default y choca con cualquier server manual abierto.
import { createOpencodeClient } from '@opencode-ai/sdk';
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';

// Config desde env vars
const SERVER_URL = process.env.OPENCODE_SERVER_URL || 'http://127.0.0.1:4096';
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD; // vacío = sin auth
const MiMo_V2_5_Free = {
    id: 'mimo-v2.5-free',
    name: 'MiMo V2.5 Free',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 32000,
    cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    },
};

// Cliente singleton
let opencodeClient: ReturnType<typeof createOpencodeClient> | null = null;

function getClient() {
    if (!opencodeClient) {
        // console.log('[opencode-server] Connecting to existing server at:', SERVER_URL);
        // console.log('[opencode-server] Auth:', SERVER_PASSWORD ? 'Bearer token configured' : 'No auth (unsecured)');

        opencodeClient = createOpencodeClient({
            baseUrl: SERVER_URL,
            headers: SERVER_PASSWORD ? { Authorization: `Bearer ${SERVER_PASSWORD}` } : undefined,
        });
    }
    return opencodeClient;
}

async function streamOpenCode(
    model: Model<any>,
    context: Context,
    options?: SimpleStreamOptions
): Promise<AssistantMessageEventStream> {
    const client = getClient();

    /*
    console.log('[opencode-server] streamOpenCode called', {
        modelId: model.id,
        systemPromptLength: context.systemPrompt?.length || 0,
        messagesCount: context.messages?.length || 0,
    });
    */

    // Build the full prompt from context
    const systemPrompt = context.systemPrompt || '';
    const messages = context.messages || [];

    let prompt = systemPrompt ? `${systemPrompt}\n\n` : '';

    for (const msg of messages) {
        if (msg.role === 'system') continue;
        const text =
            typeof msg.content === 'string'
                ? msg.content
                : msg.content?.map((c) => (c.type === 'text' ? c.text : '')).join('') || '';
        if (msg.role === 'user') {
            prompt += `[User]: ${text}\n\n`;
        } else if (msg.role === 'assistant') {
            prompt += `[Assistant]: ${text}\n\n`;
        }
    }

    prompt = prompt.trim();

    /*
    console.log('[opencode-server] Built prompt', {
        promptLength: prompt.length,
        preview: prompt.slice(0, 200),
    });
    */

    // Create session
    // console.log('[opencode-server] Creating session...');
    const sessionResult = await client.session.create({});
    const sessionId = sessionResult.data.id;
    // console.log('[opencode-server] Session created:', sessionId);

    // Send message using OpenCode SDK
    // console.log('[opencode-server] Sending message to OpenCode (model: mimo-v2.5-free)...');
    const response = await client.session.prompt({
        path: { id: sessionId },
        body: {
            parts: [{ type: 'text', text: prompt }],
            system: systemPrompt,
            model: { providerID: 'opencode', modelID: model.id },
            tools: {},
        },
    });

    /*
    console.log('[opencode-server] OpenCode response received', {
        hasData: !!response.data,
        hasError: !!response.error,
        error: response.error,
        dataKeys: response.data ? Object.keys(response.data) : null,
        parts: response.data?.parts?.map((p) => ({ type: p.type, textLength: p.text?.length })),
    });
    */

    // Extract text from response — find the part with type 'text'
    const textPart = response.data?.parts?.find((p) => p.type === 'text');
    const text = textPart?.text || 'Error: No response from OpenCode';

    /*
    console.log('[opencode-server] Extracted text', {
        textLength: text.length,
        preview: text.slice(0, 200),
    });
    */

    // Extract usage from response.info.tokens
    const tokens = response.data?.info?.tokens;
    const input = tokens?.input || 0;
    const output = tokens?.output || 0;
    const usage = {
        input,
        output,
        cacheRead: tokens?.cache?.read || 0,
        cacheWrite: tokens?.cache?.write || 0,
        cost: {
            input: 0,
            output: 0,
            total: 0,
            cacheRead: 0,
            cacheWrite: 0,
        },
    };

    // console.log('[opencode-server] Usage:', usage);

    // Create proper AssistantMessageEventStream using factory
    const stream = createAssistantMessageEventStream();

    // Build the final message object with usage (Pi requires it)
    const finalMessage = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text }],
        stopReason: 'stop' as const,
        usage,
    };

    // 1. Emit start event
    // console.log('[opencode-server] Stream: emitting start');
    stream.push({ type: 'start', partial: finalMessage });

    // 2. Emit text_start event (required by Pi)
    // console.log('[opencode-server] Stream: emitting text_start');
    stream.push({
        type: 'text_start',
        contentIndex: 0,
        partial: finalMessage,
    });

    // 3. Emit text_delta event
    // console.log('[opencode-server] Stream: emitting text_delta');
    stream.push({
        type: 'text_delta',
        contentIndex: 0,
        delta: text,
        partial: finalMessage,
    });

    // 4. Emit text_end event (required by Pi)
    // console.log('[opencode-server] Stream: emitting text_end');
    stream.push({
        type: 'text_end',
        contentIndex: 0,
        content: text,
        partial: finalMessage,
    });

    // 5. Emit done event
    // console.log('[opencode-server] Stream: emitting done');
    stream.push({
        type: 'done',
        reason: 'stop',
        message: finalMessage,
    });
    stream.end(finalMessage);
    // console.log('[opencode-server] Stream: closed');

    return stream;
}

export default function (pi: ExtensionAPI) {
    // console.log('[opencode-server] Extension loaded, registering provider');
    // console.log('[opencode-server] Server URL:', SERVER_URL);
    pi.registerProvider('opencode-server', {
        name: 'OpenCode Server',
        baseUrl: SERVER_URL,
        apiKey: SERVER_PASSWORD || 'opencode',
        api: 'opencode-server',
        models: [MiMo_V2_5_Free],
        streamSimple: streamOpenCode,
    });
}
