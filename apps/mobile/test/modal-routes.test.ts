const { readFileSync } = jest.requireActual<{ readFileSync: (path: string, encoding: string) => string }>('fs');

const app = `${process.cwd()}/app`;

/**
 * On iPhone a native modal sits outside the app's root view, so it gets no safe-area insets from the root
 * provider and its top bar ends up under the status bar. Android does not show this, so the emulator
 * journeys cannot catch it: this checks every route opened that way has its own providers.
 */
describe('screens opened as native modals', () => {
  const layout = readFileSync(`${app}/_layout.tsx`, 'utf8');
  const modals = [...layout.matchAll(/<Stack\.Screen\s+name="([^"]+)"\s+options=\{\{[^}]*presentation:/g)].map(
    (m) => m[1] as string,
  );

  it('finds the modal routes', () => {
    expect(modals).toEqual(
      expect.arrayContaining(['compose', 'admin/announcement', 'admin/drafts', 'admin/subscribers/new']),
    );
  });

  it.each(modals.length ? modals : ['none'])('%s has its own safe area and toasts', (route) => {
    const source = readFileSync(`${app}/${route}.tsx`, 'utf8');
    expect(source).toContain('<ModalFrame>');
  });
});
