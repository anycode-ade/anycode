const rawStderrWrite = process.stderr.write.bind(process.stderr);

export function extHostLog(category: string, ...args: any[]): void {
  const timestamp = new Date().toISOString().slice(11, 23);
  const formatted = args
    .map((a) => {
      if (typeof a === 'object' && a !== null) {
        try {
          return a.stack || JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ');

  rawStderrWrite(`[ext-host:${category}] ${timestamp} ${formatted}\n`);
}
