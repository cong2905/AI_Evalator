import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without globals here, so Testing Library's own auto-cleanup
// (which hooks a global afterEach) never registers — do it explicitly.
afterEach(cleanup);
