/**
 * Ambient type declarations for Pi extension development.
 * These packages are installed globally with Pi, not in the project.
 */

declare module '@earendil-works/pi-coding-agent' {
  export interface ExtensionAPI {
    on(event: string, handler: (...args: any[]) => any): void;
    registerTool(tool: any): void;
    registerProvider(name: string, config: any): void;
    registerCommand(name: string, options: any): void;
    registerShortcut(shortcut: string, options: any): void;
    registerFlag(name: string, options: any): void;
    registerMessageRenderer(type: string, renderer: any): void;
    registerMarkdownTransformer(transformer: any): void;
    registerEntryRenderer(type: string, renderer: any): void;
    sendMessage(message: any, options?: any): void;
    sendUserMessage(content: any, options?: any): void;
    appendEntry(type: string, data?: any): void;
    setSessionName(name: string): void;
    getSessionName(): string;
    setLabel(entryId: string, label: string): void;
    getCommands(): any;
    exec(command: string, args: string[], options?: any): any;
    getActiveTools(): string[];
    getAllTools(): string[];
    setActiveTools(names: string[]): void;
    setModel(model: any): void;
    getThinkingLevel(): string;
    setThinkingLevel(level: string): void;
    events: any;
  }

  export interface ExtensionContext {
    ui: any;
    mode: string;
    hasUI: boolean;
    cwd: string;
    isProjectTrusted(): boolean;
    sessionManager: any;
    modelRegistry: any;
    model: any;
    thinkingLevel: string;
    signal: AbortSignal;
    isIdle(): boolean;
    abort(): void;
    hasPendingMessages(): boolean;
    shutdown(): void;
    getContextUsage(): any;
    compact(): void;
    getSystemPrompt(): string;
  }
}

declare module '@earendil-works/pi-ai' {
  export interface Model<T = any> {
    id: string;
    name?: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
    };
  }

  export interface Context {
    systemPrompt?: string;
    messages?: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string | Array<{ type: string; text: string }>;
    }>;
  }

  export interface SimpleStreamOptions {
    [key: string]: any;
  }

  export interface AssistantMessageEventStream {
    push(event: any): void;
    end(message: any): void;
  }

  export function createAssistantMessageEventStream(): AssistantMessageEventStream;
  export function StringEnum(values: string[]): any;
}

declare module 'typebox' {
  export const Type: {
    Object(properties: Record<string, any>): any;
    String(options?: any): any;
    Number(options?: any): any;
    Boolean(options?: any): any;
    Array(items: any, options?: any): any;
    Optional(schema: any): any;
    Null(): any;
    Union(schemas: any[]): any;
    Literal(value: any): any;
    Record(key: any, value: any): any;
    Tuple(schemas: any[]): any;
    Enum(values: Record<string, any>): any;
  };
}
