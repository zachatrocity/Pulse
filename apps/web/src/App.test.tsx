import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from './App.js';

describe('App', () => {
  it('renders the Pulse landing experience', () => {
    render(<App />);

    expect(screen.getByRole('heading', { name: 'Pulse', level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/Portable identity from AT Protocol/i)).toBeInTheDocument();
  });
});
