import { EventEmitter } from 'events';

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: any;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export class RpcConnection {
  private _nextId = 1;
  private _pendingRequests = new Map<number | string, { resolve: (val: any) => void; reject: (err: any) => void }>();
  private _requestHandlers = new Map<string, (params: any) => Promise<any> | any>();
  private _notificationHandlers = new Map<string, (params: any) => void>();
  private _buffer = Buffer.alloc(0);
  private _contentLength = -1;

  constructor(private _input: NodeJS.ReadableStream = process.stdin, private _output: NodeJS.WritableStream = process.stdout) {
    this._input.on('data', (chunk: Buffer) => this._onData(chunk));
    this._input.on('error', (err: any) => {
      console.warn('[rpc] Input stream error:', err?.message || err);
    });
    this._output.on('error', (err: any) => {
      console.warn('[rpc] Output stream error:', err?.message || err);
    });
  }

  private _onData(chunk: Buffer): void {
    this._buffer = Buffer.concat([this._buffer, chunk]);
    this._processBuffer();
  }

  private _processBuffer(): void {
    while (true) {
      if (this._contentLength === -1) {
        // Look for header separator \r\n\r\n
        const headerEnd = this._buffer.indexOf('\r\n\r\n');
        if (headerEnd === -1) {
          // Check for newline-delimited JSON fallback
          const newlineIdx = this._buffer.indexOf('\n');
          if (newlineIdx !== -1) {
            const line = this._buffer.slice(0, newlineIdx).toString('utf-8').trim();
            if (line.startsWith('{') && line.endsWith('}')) {
              this._buffer = this._buffer.slice(newlineIdx + 1);
              try {
                this._handleMessage(JSON.parse(line));
              } catch (e) {
                console.error('Error parsing JSON line:', e);
              }
              continue;
            }
          }
          break;
        }

        const headerStr = this._buffer.slice(0, headerEnd).toString('utf-8');
        const match = /Content-Length:\s*(\d+)/i.exec(headerStr);
        if (match) {
          this._contentLength = parseInt(match[1], 10);
        } else {
          console.error('No Content-Length header found in RPC message');
        }
        this._buffer = this._buffer.slice(headerEnd + 4);
      }

      if (this._contentLength !== -1) {
        if (this._buffer.length < this._contentLength) {
          break; // Need more data
        }

        const bodyBuf = this._buffer.slice(0, this._contentLength);
        this._buffer = this._buffer.slice(this._contentLength);
        this._contentLength = -1;

        try {
          const msg = JSON.parse(bodyBuf.toString('utf-8'));
          this._handleMessage(msg);
        } catch (err) {
          console.error('Failed to parse JSON-RPC message body:', err);
        }
      }
    }
  }

  private async _handleMessage(msg: any): Promise<void> {
    if ('method' in msg) {
      // It's a request or notification
      if ('id' in msg && msg.id !== undefined && msg.id !== null) {
        const handler = this._requestHandlers.get(msg.method);
        if (!handler) {
          this._sendResponse({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32601, message: `Method not found: ${msg.method}` },
          });
          return;
        }

        try {
          const result = await handler(msg.params);
          this._sendResponse({
            jsonrpc: '2.0',
            id: msg.id,
            result: result !== undefined ? result : null,
          });
        } catch (err: any) {
          this._sendResponse({
            jsonrpc: '2.0',
            id: msg.id,
            error: { code: -32000, message: err?.message || String(err) },
          });
        }
      } else {
        // Notification
        const handler = this._notificationHandlers.get(msg.method);
        if (handler) {
          try {
            handler(msg.params);
          } catch (err) {
            console.error(`Notification handler error for ${msg.method}:`, err);
          }
        }
      }
    } else if ('id' in msg && ('result' in msg || 'error' in msg)) {
      // Response to a pending request
      const pending = this._pendingRequests.get(msg.id);
      if (pending) {
        this._pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || 'RPC Error'));
        } else {
          pending.resolve(msg.result);
        }
      }
    }
  }

  sendRequest(method: string, params?: any): Promise<any> {
    const id = this._nextId++;
    return new Promise((resolve, reject) => {
      this._pendingRequests.set(id, { resolve, reject });
      const msg: JsonRpcRequest = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };
      this._write(msg);
    });
  }

  sendNotification(method: string, params?: any): void {
    const msg: JsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
    };
    this._write(msg);
  }

  onRequest(method: string, handler: (params: any) => Promise<any> | any): void {
    this._requestHandlers.set(method, handler);
  }

  onNotification(method: string, handler: (params: any) => void): void {
    this._notificationHandlers.set(method, handler);
  }

  private _sendResponse(resp: JsonRpcResponse): void {
    this._write(resp);
  }

  private _write(msg: any): void {
    try {
      const outputAny = this._output as any;
      if (outputAny.destroyed || outputAny.writableEnded || (typeof outputAny.writable === 'boolean' && !outputAny.writable)) {
        return;
      }
      const json = JSON.stringify(msg);
      const bodyBuf = Buffer.from(json, 'utf-8');
      const header = `Content-Length: ${bodyBuf.length}\r\n\r\n`;
      this._output.write(header, (err) => {
        if (err) console.warn('[rpc] Write error (header):', err?.message || err);
      });
      this._output.write(bodyBuf, (err) => {
        if (err) console.warn('[rpc] Write error (body):', err?.message || err);
      });
    } catch (e: any) {
      console.warn('[rpc] Write exception:', e?.message || e);
    }
  }
}
