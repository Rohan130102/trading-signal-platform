import { defineConfig } from 'vitest/config';
import { BaseSequencer, type TestSpecification } from 'vitest/node';

/** Alphabetical, so the file that stops the database reliably runs last. */
class ByName extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return [...files].sort((a, b) => a.moduleId.localeCompare(b.moduleId));
  }
}

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // One shared server and database: files run one after another so tests can stop services.
    fileParallelism: false,
    sequence: { concurrent: false, sequencer: ByName },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 30_000,
    reporters: ['default'],
  },
});
