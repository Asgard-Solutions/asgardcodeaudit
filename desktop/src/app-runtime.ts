// Production IPC wiring extracted from main.ts so the SAME registration, allow-
// list, sender validation and error envelope can be exercised by connected tests
// with only the external runtime boundaries (electron net/dialog/ipcMain/window)
// substituted. No business logic is duplicated in tests.

import {
  resolveOperation,
  validateBody,
  isTrustedFrame,
  IpcValidationError,
  ipcOk,
  ipcFail,
  IPC,
  type IpcResult,
} from "./ipc";
import { APP_ORIGIN } from "./protocol";

export interface BackendRef {
  host: string;
  port: number;
  secret: string;
}

export interface SenderLike {
  send: (channel: string, ...args: unknown[]) => void;
}
export interface IpcEventLike {
  sender: SenderLike;
  senderFrame: { url?: string; parent: unknown } | null;
}

export interface RuntimeCtx {
  getBackend: () => BackendRef | null;
  getMainSender: () => SenderLike | null;
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  openDirectory: () => Promise<{ canceled: boolean; filePaths: string[] }>;
  retry: () => Promise<unknown>;
  getUnavailableStatus: () => unknown | null;
}

export interface IpcMainLike {
  handle: (channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => unknown) => void;
  on: (channel: string, listener: (event: IpcEventLike, ...args: unknown[]) => void) => void;
}

export function isTrustedSender(ctx: RuntimeCtx, event: IpcEventLike): boolean {
  const wc = ctx.getMainSender();
  if (!wc || event.sender !== wc) return false;
  const frame = event.senderFrame;
  const isMainFrame = !!frame && frame.parent === null;
  return isTrustedFrame(frame?.url, isMainFrame, APP_ORIGIN);
}

export async function callBackend<T>(
  ctx: RuntimeCtx,
  method: string,
  apiPath: string,
  body?: unknown
): Promise<IpcResult<T>> {
  const backend = ctx.getBackend();
  if (!backend) return ipcFail("The local analysis backend is unavailable.", 503, "backend_unavailable");
  const url = `http://${backend.host}:${backend.port}${apiPath}`;
  let res: Response;
  try {
    res = await ctx.fetchImpl(url, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${backend.secret}` },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return ipcFail("The local analysis backend is unavailable.", 503, "backend_unavailable");
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    return ipcFail("The backend returned a malformed response.", 502, "malformed_response");
  }
  if (!res.ok) {
    const detail = (data as { detail?: unknown } | undefined)?.detail;
    let message = `Request failed (${res.status}).`;
    let code: string | undefined;
    if (detail && typeof detail === "object") {
      const d = detail as { message?: unknown; code?: unknown };
      if (typeof d.message === "string") message = d.message;
      if (typeof d.code === "string") code = d.code;
    } else if (typeof detail === "string") {
      message = detail;
    }
    return ipcFail(message, res.status, code);
  }
  return ipcOk(data as T);
}

export function registerIpcHandlers(ipcMain: IpcMainLike, ctx: RuntimeCtx): void {
  ipcMain.handle(IPC.HANDSHAKE, async (event): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(ctx, event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    return callBackend(ctx, "GET", "/api/v1/startup/handshake");
  });

  ipcMain.handle(IPC.REQUEST, async (event, payload: unknown): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(ctx, event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    const { method, path: apiPath, body } = (payload ?? {}) as {
      method?: unknown;
      path?: unknown;
      body?: unknown;
    };
    try {
      const op = resolveOperation(method, apiPath);
      const validBody = validateBody(op, body);
      return await callBackend(ctx, op.method, apiPath as string, validBody);
    } catch (e) {
      if (e instanceof IpcValidationError) return ipcFail(e.message, 400, "ipc_validation");
      return ipcFail("The request could not be processed.", 500, "ipc_error");
    }
  });

  ipcMain.handle(IPC.SELECT_FOLDER, async (event): Promise<IpcResult<string | null>> => {
    if (!isTrustedSender(ctx, event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    const result = await ctx.openDirectory();
    if (result.canceled || result.filePaths.length === 0) return ipcOk(null);
    return ipcOk(result.filePaths[0]);
  });

  ipcMain.handle(IPC.RETRY_BACKEND, async (event): Promise<IpcResult<unknown>> => {
    if (!isTrustedSender(ctx, event)) return ipcFail("Rejected: untrusted sender.", 403, "untrusted_sender");
    try {
      const identity = await ctx.retry();
      return ipcOk(identity);
    } catch (e) {
      const err = e as { code?: string; message?: string };
      return ipcFail(err?.message ?? "Recovery failed.", 503, err?.code ?? "recovery_failed");
    }
  });

  ipcMain.on(IPC.BACKEND_SUBSCRIBE, (event) => {
    if (!isTrustedSender(ctx, event)) return;
    const status = ctx.getUnavailableStatus();
    if (status) event.sender.send(IPC.BACKEND_UNAVAILABLE, status);
  });
}
