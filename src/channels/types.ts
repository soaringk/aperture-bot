export interface Attachment {
  type: string;
  url?: string;
  name?: string;
  mimeType?: string;
  data?: Buffer;
}

export interface IMessage {
  id: string;
  channelId: string;
  threadId?: string;
  userId: string;
  userName: string;
  text: string;
  timestamp: number;
  attachments?: Attachment[];
  /** Original platform-specific message object */
  raw: unknown;
}

export interface ISession {
  /** Composite key: {channelType}:{channelId}:{threadId?} */
  sessionId: string;
  channelType: string;
  channelId: string;
  threadId?: string;
  /** Aperture user ID (mapped from platform user ID) */
  userId: string;
}

export interface IMessageChannel {
  readonly type: string;

  connect(): Promise<void>;
  disconnect(): Promise<void>;

  sendMessage(session: ISession, text: string): Promise<string>;
  sendThreadReply(session: ISession, text: string): Promise<string>;
  updateMessage(
    session: ISession,
    messageId: string,
    text: string,
  ): Promise<void>;
  uploadFile(
    session: ISession,
    filePath: string,
    title?: string,
  ): Promise<void>;
  setTyping(session: ISession, active: boolean): Promise<void>;

  onMessage(handler: MessageHandler): void;
}

export type MessageHandler = (
  message: IMessage,
  session: ISession,
) => Promise<void>;
