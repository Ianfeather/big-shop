declare module 'formidable' {
  import { IncomingMessage } from 'http';

  export interface File {
    filepath: string;
    mimetype: string | null;
    size: number;
    originalFilename?: string | null;
  }

  export interface Fields {
    [key: string]: string[] | undefined;
  }

  export interface Files {
    [key: string]: File[] | undefined;
  }

  export interface Options {
    maxFileSize?: number;
    keepExtensions?: boolean;
  }

  export interface IncomingForm {
    parse(
      req: IncomingMessage,
      callback: (err: Error | null, fields: Fields, files: Files) => void
    ): void;
  }

  export default function formidable(options?: Options): IncomingForm;
}
