import { resolveApiConfig, socketUrl } from '@/lib/config';

describe('the server address', () => {
  it('takes the configured address in any build, without a trailing slash', () => {
    expect(resolveApiConfig('https://api.example.com/', 'production', null)).toEqual({
      origin: 'https://api.example.com',
      problem: null,
    });
    expect(resolveApiConfig('http://10.0.2.2:4000', 'development', null).origin).toBe('http://10.0.2.2:4000');
  });

  it('in development falls back to wherever Expo is being served from, because localhost on a phone is the phone', () => {
    expect(resolveApiConfig('', 'development', 'http://192.168.1.20:4000').origin).toBe('http://192.168.1.20:4000');
  });

  it('never falls back in a real build', () => {
    expect(resolveApiConfig('', 'production', 'http://192.168.1.20:4000').origin).toBeNull();
    expect(resolveApiConfig(undefined, 'preview', 'http://192.168.1.20:4000').problem).toContain('no server address');
  });

  it('refuses plain HTTP outside development', () => {
    for (const variant of ['preview', 'production']) {
      const config = resolveApiConfig('http://api.example.com', variant, null);
      expect(config.origin).toBeNull();
      expect(config.problem).toContain('HTTPS');
    }
  });

  it('refuses nonsense', () => {
    expect(resolveApiConfig('not a url', 'production', null).problem).toContain('invalid');
  });

  it('derives the live stream address', () => {
    expect(socketUrl('https://api.example.com')).toBe('wss://api.example.com/ws');
    expect(socketUrl('http://localhost:4000')).toBe('ws://localhost:4000/ws');
  });
});
