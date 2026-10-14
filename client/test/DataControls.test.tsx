import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataControls } from '../src/components/DataControls';
import { ApiClientError } from '../src/api';

const api = vi.hoisted(() => ({
  createTransferCode: vi.fn(),
  adoptSession: vi.fn(),
  deleteMyData: vi.fn(),
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, api };
});

const onSessionChanged = vi.fn();

function renderControls(hasData = false) {
  return render(<DataControls hasData={hasData} onSessionChanged={onSessionChanged} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  api.createTransferCode.mockResolvedValue({
    code: 'K4M9-PT2X',
    expiresAt: new Date(Date.now() + 600_000).toISOString(),
  });
  api.adoptSession.mockResolvedValue(undefined);
  api.deleteMyData.mockResolvedValue(undefined);
});

describe('the retention notice', () => {
  it('states how long data is kept and where the text goes', () => {
    renderControls();

    expect(screen.getByText(/deleted after 7 days without a visit/i)).toBeInTheDocument();
    expect(screen.getByText(/sent to Groq/i)).toBeInTheDocument();
  });
});

describe('transfer codes', () => {
  it('shows the code with its expiry and a plain warning', async () => {
    const user = userEvent.setup();
    renderControls();

    await user.click(screen.getByRole('button', { name: /get a code/i }));

    expect(await screen.findByText('K4M9-PT2X')).toBeInTheDocument();
    expect(screen.getByText(/anyone with this code can open your evaluations/i)).toBeInTheDocument();
  });

  it('counts the code down and drops it when it expires', async () => {
    const user = userEvent.setup();
    // Real timers: the countdown interval is created inside the component, so
    // swapping in fake timers afterwards would not control it anyway.
    api.createTransferCode.mockResolvedValue({
      code: 'K4M9-PT2X',
      expiresAt: new Date(Date.now() + 1200).toISOString(),
    });
    renderControls();

    await user.click(screen.getByRole('button', { name: /get a code/i }));
    await screen.findByText('K4M9-PT2X');

    await waitFor(() => expect(screen.queryByText('K4M9-PT2X')).not.toBeInTheDocument(), {
      timeout: 5000,
    });
    expect(screen.getByRole('button', { name: /get a code/i })).toBeInTheDocument();
  });

  it('adopts a code straight away when this device has nothing to lose', async () => {
    const user = userEvent.setup();
    renderControls(false);

    await user.type(screen.getByLabelText(/transfer code/i), 'k4m9-pt2x');
    await user.click(screen.getByRole('button', { name: /use code/i }));

    await waitFor(() => expect(api.adoptSession).toHaveBeenCalledWith('k4m9-pt2x'));
    expect(onSessionChanged).toHaveBeenCalled();
  });

  it('warns before overwriting a device that already has evaluations', async () => {
    const user = userEvent.setup();
    renderControls(true);

    await user.type(screen.getByLabelText(/transfer code/i), 'K4M9-PT2X');
    await user.click(screen.getByRole('button', { name: /use code/i }));

    expect(screen.getByText(/will no longer be reachable/i)).toBeInTheDocument();
    expect(api.adoptSession).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: /continue/i }));
    await waitFor(() => expect(api.adoptSession).toHaveBeenCalled());
  });

  it('reports a rejected code without clearing what was typed', async () => {
    const user = userEvent.setup();
    api.adoptSession.mockRejectedValue(
      new ApiClientError(400, 'VALIDATION_ERROR', 'That code is not valid.'),
    );
    renderControls(false);

    await user.type(screen.getByLabelText(/transfer code/i), 'WRON-GCDE');
    await user.click(screen.getByRole('button', { name: /use code/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/not valid/i);
    expect(screen.getByLabelText(/transfer code/i)).toHaveValue('WRON-GCDE');
  });

  it('keeps the Use code button disabled until something is typed', () => {
    renderControls();

    expect(screen.getByRole('button', { name: /use code/i })).toBeDisabled();
  });
});

describe('delete my data', () => {
  it('asks before deleting', async () => {
    const user = userEvent.setup();
    renderControls(true);

    await user.click(screen.getByRole('button', { name: /delete my data/i }));

    expect(screen.getByText(/delete every evaluation and resume/i)).toBeInTheDocument();
    expect(api.deleteMyData).not.toHaveBeenCalled();
  });

  it('can be backed out of', async () => {
    const user = userEvent.setup();
    renderControls(true);

    await user.click(screen.getByRole('button', { name: /delete my data/i }));
    await user.click(screen.getByRole('button', { name: /keep it/i }));

    expect(screen.getByRole('button', { name: /delete my data/i })).toBeInTheDocument();
    expect(api.deleteMyData).not.toHaveBeenCalled();
  });

  it('deletes and tells the page to reload', async () => {
    const user = userEvent.setup();
    renderControls(true);

    await user.click(screen.getByRole('button', { name: /delete my data/i }));
    await user.click(screen.getByRole('button', { name: /yes, delete everything/i }));

    await waitFor(() => expect(api.deleteMyData).toHaveBeenCalled());
    expect(onSessionChanged).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/has been deleted/i);
  });
});
