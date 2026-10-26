import { afterEach, expect } from '@rstest/core';
import * as matchers from '@testing-library/jest-dom/matchers';
import type { TestingLibraryMatchers } from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';

declare module '@rstest/core' {
  interface Matchers<T = any> extends TestingLibraryMatchers<unknown, T> {}
}

expect.extend(matchers);
afterEach(cleanup);
