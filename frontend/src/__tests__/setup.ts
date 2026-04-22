import "@testing-library/jest-dom";

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------
// Vitest's jsdom integration does not always expose the real Storage API on
// the global `localStorage` that modules reference at import time. We provide
// a simple in-memory mock that covers the API surface used by auth-storage.ts.
const _createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
};

const localStorageMock = _createStorageMock();
Object.defineProperty(global, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Reset between tests
beforeEach(() => {
  localStorageMock.clear();
});

// Silence specific React testing noise
const _originalError = console.error.bind(console);
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    if (
      typeof args[0] === "string" &&
      (args[0].includes("Warning: ReactDOM.render") ||
        args[0].includes("act(...)"))
    ) {
      return;
    }
    _originalError(...args);
  };
});
afterAll(() => {
  console.error = _originalError;
});
