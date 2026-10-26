export interface Lang {
  query: string;
  foldsQuery?: string;
  indent: {
    width: number;
    unit: string;
  };
  comment: string;
  runnablesQuery?: string;
  executable?: boolean;
  cmd?: string;
  cmdTest?: string;
}
