import { APIStatusError } from '@moonshot-ai/kosong';
import { describe, expect, it } from 'vitest';

import { toKimiErrorPayload } from '#/errors/serialize';

const NGINX_413_HTML =
  '413 <html>\r\n<head><title>413 Request Entity Too Large</title></head>\r\n' +
  '<body>\r\n<center><h1>413 Request Entity Too Large</h1></center>\r\n' +
  '<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

describe('toKimiErrorPayload APIStatusError message sanitization', () => {
  it('extracts the title from an nginx HTML body and strips carriage returns', () => {
    const payload = toKimiErrorPayload(new APIStatusError(413, NGINX_413_HTML));

    expect(payload.code).toBe('provider.api_error');
    expect(payload.message).toBe('413 Request Entity Too Large');
    expect(payload.details).toMatchObject({ statusCode: 413 });
  });

  it('leaves plain text unchanged except for carriage returns', () => {
    const payload = toKimiErrorPayload(new APIStatusError(500, 'line1\r\nline2\r'));

    expect(payload.message).toBe('line1\nline2');
  });

  it('keeps status-specific error codes while sanitizing the message', () => {
    const html = '<html><head><title>429 Too Many Requests</title></head></html>';

    expect(toKimiErrorPayload(new APIStatusError(429, html)).code).toBe(
      'provider.rate_limit',
    );
    expect(toKimiErrorPayload(new APIStatusError(401, 'Unauthorized')).code).toBe(
      'provider.auth_error',
    );
  });
});
