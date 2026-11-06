// Ошибка, которую сервер превращает в понятный JSON-ответ: { error: 'код', ...extra }.
export class HttpError extends Error {
  constructor(status, code, extra = {}) {
    super(code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
