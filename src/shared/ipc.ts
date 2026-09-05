export interface AudioFileResult {
  filePath: string;
  name: string;
  size: number;
  data: Uint8Array;
}

export interface TextFileResult {
  canceled: boolean;
  filePath?: string;
  content?: string;
}

export interface SaveResult {
  canceled: boolean;
  filePath?: string;
}

export interface IpcApi {
  openAudio: () => Promise<AudioFileResult | null>;
  readAudioFile: (filePath: string) => Promise<AudioFileResult | null>;
  openTextFile: () => Promise<TextFileResult>;
  saveTextFile: (defaultPath: string, content: string) => Promise<SaveResult>;
  saveProjectFile: (
    defaultPath: string,
    content: string,
  ) => Promise<SaveResult>;
  getFilePath: (title: string) => Promise<string | null>;
}
