import { describe, it, expect, vi, beforeEach } from 'vitest';
import { standardSiteLoader, publicationLoader } from '../src/loader.js';
import { COLLECTIONS } from '../src/schemas.js';

// Shared fixture store, hoisted so the vi.mock factory can read it.
const mocks = vi.hoisted(() => ({
  recordsByCollection: new Map<
    string,
    Array<{ uri: string; cid: string; value: unknown }>
  >(),
}));

vi.mock('@atproto/api', () => {
  class MockAtpAgent {
    resolveHandle = vi.fn(async () => ({ data: { did: 'did:plc:test123' } }));
    api = {
      com: {
        atproto: {
          repo: {
            listRecords: vi.fn(async ({ collection }: { collection: string }) => ({
              data: { records: mocks.recordsByCollection.get(collection) ?? [] },
            })),
          },
        },
      },
    };
  }
  return { AtpAgent: MockAtpAgent };
});

const VALID_DOC = {
  uri: 'at://did:plc:test123/site.standard.document/3jzfcijpj2z2a',
  cid: 'bafytestdoc1',
  value: {
    $type: 'site.standard.document',
    site: 'https://example.com',
    title: 'Hello World',
    publishedAt: '2026-01-01T00:00:00.000Z',
    path: '/hello',
    tags: ['intro'],
  },
};

const INVALID_DOC = {
  uri: 'at://did:plc:test123/site.standard.document/3jzfcijpj2z2b',
  cid: 'bafytestdoc2',
  value: {
    $type: 'site.standard.document',
    // Missing required fields: site, title, publishedAt
    path: '/oops',
  },
};

const VALID_PUB = {
  uri: 'at://did:plc:test123/site.standard.publication/3jzfcijpj2z2c',
  cid: 'bafytestpub1',
  value: {
    $type: 'site.standard.publication',
    url: 'https://example.com',
    name: 'Example Blog',
    description: 'A test publication',
  },
};

function makeV5Context() {
  return {
    store: { set: vi.fn(), clear: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    generateDigest: (data: unknown) => `digest-${JSON.stringify(data).length}`,
  };
}

// Astro v6 LoaderContext: { store, meta, logger } — no generateDigest.
// The loader doesn't read from meta, so this fixture only needs a minimal
// shape to stand in for it.
function makeV6Context() {
  return {
    store: { set: vi.fn(), clear: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    meta: { get: vi.fn(), set: vi.fn(), has: vi.fn(), delete: vi.fn() },
  };
}

beforeEach(() => {
  mocks.recordsByCollection.clear();
});

describe('standardSiteLoader', () => {
  describe('v5 LoaderContext shape', () => {
    it('loads valid documents and calls store.set with a digest', async () => {
      mocks.recordsByCollection.set(COLLECTIONS.DOCUMENT, [VALID_DOC]);
      const loader = standardSiteLoader({ repo: 'test.bsky.social' });
      const ctx = makeV5Context();

      await loader.load(ctx as any);

      expect(ctx.store.clear).toHaveBeenCalledTimes(1);
      expect(ctx.store.set).toHaveBeenCalledTimes(1);
      const call = (ctx.store.set as any).mock.calls[0][0];
      expect(call.id).toBe('3jzfcijpj2z2a');
      expect(call.digest).toMatch(/^digest-\d+$/);
      expect(call.data).toMatchObject({
        title: 'Hello World',
        site: 'https://example.com',
      });
    });

    it('warns and skips invalid documents', async () => {
      mocks.recordsByCollection.set(COLLECTIONS.DOCUMENT, [VALID_DOC, INVALID_DOC]);
      const loader = standardSiteLoader({ repo: 'test.bsky.social' });
      const ctx = makeV5Context();

      await loader.load(ctx as any);

      expect(ctx.store.set).toHaveBeenCalledTimes(1);
      expect(ctx.logger.warn).toHaveBeenCalled();
      const warnMessages = (ctx.logger.warn as any).mock.calls
        .map((c: unknown[]) => c[0])
        .join('\n');
      expect(warnMessages).toContain('Invalid document schema');
    });

    it('publication filter excludes documents from non-matching sites', async () => {
      mocks.recordsByCollection.set(COLLECTIONS.DOCUMENT, [VALID_DOC]);
      const loader = standardSiteLoader({
        repo: 'test.bsky.social',
        publication: 'https://other.example',
      });
      const ctx = makeV5Context();

      await loader.load(ctx as any);

      expect(ctx.store.set).not.toHaveBeenCalled();
    });
  });

  describe('v6 LoaderContext shape', () => {
    it('loads valid documents when generateDigest is absent', async () => {
      mocks.recordsByCollection.set(COLLECTIONS.DOCUMENT, [VALID_DOC]);
      const loader = standardSiteLoader({ repo: 'test.bsky.social' });
      const ctx = makeV6Context();

      await loader.load(ctx as any);

      expect(ctx.store.set).toHaveBeenCalledTimes(1);
      const call = (ctx.store.set as any).mock.calls[0][0];
      expect(call.digest).toEqual(expect.any(String));
    });

    it('exposes createSchema() returning a Zod schema and types string', async () => {
      const loader = standardSiteLoader({ repo: 'test.bsky.social' });
      expect(typeof (loader as any).createSchema).toBe('function');
      const result = await (loader as any).createSchema();
      expect(result.schema).toBeDefined();
      expect(typeof result.types).toBe('string');
    });
  });
});

describe('publicationLoader', () => {
  it('v5 shape: loads valid publications', async () => {
    mocks.recordsByCollection.set(COLLECTIONS.PUBLICATION, [VALID_PUB]);
    const loader = publicationLoader({ repo: 'test.bsky.social' });
    const ctx = makeV5Context();

    await loader.load(ctx as any);

    expect(ctx.store.clear).toHaveBeenCalledTimes(1);
    expect(ctx.store.set).toHaveBeenCalledTimes(1);
    const call = (ctx.store.set as any).mock.calls[0][0];
    expect(call.data).toMatchObject({
      name: 'Example Blog',
      url: 'https://example.com',
    });
  });

  it('v6 shape: loads valid publications when generateDigest is absent', async () => {
    mocks.recordsByCollection.set(COLLECTIONS.PUBLICATION, [VALID_PUB]);
    const loader = publicationLoader({ repo: 'test.bsky.social' });
    const ctx = makeV6Context();

    await loader.load(ctx as any);

    expect(ctx.store.set).toHaveBeenCalledTimes(1);
    const call = (ctx.store.set as any).mock.calls[0][0];
    expect(call.digest).toEqual(expect.any(String));
  });
});
