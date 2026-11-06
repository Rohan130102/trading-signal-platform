import { api, ApiError, queryString, setApiToken, setSessionEndedHandler } from '@/lib/api';

jest.mock('@/lib/config', () => ({ API: { origin: 'https://api.test', problem: null } }));

const respond = (status: number, body: unknown) =>
  ({
    ok: status < 400,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }) as Response;

describe('talking to the server', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as never;
    setApiToken(null);
    setSessionEndedHandler(null);
  });

  it('sends the session as a bearer token, and no cookie or origin', async () => {
    setApiToken('abc');
    fetchMock.mockResolvedValue(respond(200, { ok: true }));
    await api.post('/feed/read', { seq: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/feed/read');
    expect(init.headers.authorization).toBe('Bearer abc');
    expect(init.headers.cookie).toBeUndefined();
    expect(init.headers.origin).toBeUndefined();
    expect(init.body).toBe('{"seq":1}');
  });

  it('reports a lost connection in words a person understands', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));
    const error = (await api.get('/feed').catch((e) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetwork).toBe(true);
    expect(error.message).toContain('Could not reach the server');
  });

  it('keeps the server code, message and details', async () => {
    fetchMock.mockResolvedValue(
      respond(409, { error: { code: 'STALE_VERSION', message: 'Changed.', details: { ref: 'T-1' } } }),
    );
    const error = (await api.get('/x').catch((e) => e)) as ApiError;
    expect(error.code).toBe('STALE_VERSION');
    expect(error.message).toBe('Changed.');
    expect(error.details?.ref).toBe('T-1');
  });

  it('copes with a proxy error page that is not JSON', async () => {
    fetchMock.mockResolvedValue(respond(502, '<html>Bad gateway</html>'));
    const error = (await api.get('/x').catch((e) => e)) as ApiError;
    expect(error.code).toBe('SERVER_UNAVAILABLE');
  });

  it('ends the session when the server refuses the token', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    setApiToken('old');
    fetchMock.mockResolvedValue(respond(401, { error: { code: 'UNAUTHENTICATED', message: 'No.' } }));
    await api.get('/feed').catch(() => undefined);
    expect(ended).toHaveBeenCalledTimes(1);
  });

  it('a wrong password at sign-in does not count as a session ending', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    fetchMock.mockResolvedValue(respond(401, { error: { code: 'INVALID_CREDENTIALS', message: 'No.' } }));
    await api.post('/auth/token', {}).catch(() => undefined);
    expect(ended).not.toHaveBeenCalled();
  });

  it('a late refusal of an old token does not sign out a newer session', async () => {
    const ended = jest.fn();
    setSessionEndedHandler(ended);
    setApiToken('old');
    fetchMock.mockImplementation(async () => {
      setApiToken('new');
      return respond(401, { error: { code: 'UNAUTHENTICATED', message: 'No.' } });
    });
    await api.get('/feed').catch(() => undefined);
    expect(ended).not.toHaveBeenCalled();
  });

  it('builds query strings, leaving out what is empty', () => {
    expect(queryString({ q: 'a b', page: 2, empty: '', none: undefined, off: false })).toBe('?q=a%20b&page=2');
    expect(queryString({ none: null })).toBe('');
  });
});
