import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { JobDetail, JobSummary } from '@app/shared';
import { JobsPage } from '../src/pages/JobsPage';
import { ApiClientError } from '../src/api';

const api = vi.hoisted(() => ({
  listJobs: vi.fn(),
  getJob: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, api };
});

const SUMMARIES: JobSummary[] = [
  {
    id: 7,
    jobName: 'Frontend Engineer',
    company: 'Acme',
    matchScore: 72,
    createdAt: '2026-10-11T10:00:00.000Z',
  },
  {
    id: 4,
    jobName: 'Data Analyst',
    company: 'Globex',
    matchScore: 41,
    createdAt: '2026-10-09T10:00:00.000Z',
  },
];

const DETAIL: JobDetail = {
  ...SUMMARIES[0]!,
  summary: 'Strong React, weaker on testing.',
  missingKeywords: ['Playwright'],
  jdText: 'Full job description text goes here.',
  model: 'openai/gpt-oss-120b',
  resumeLabel: 'sample-resume.pdf',
  items: [
    {
      requirement: '3+ years React',
      category: 'skill',
      importance: 'must',
      evidence: 'Built React dashboards',
      status: 'met',
    },
    {
      requirement: 'Design systems',
      category: 'experience',
      importance: 'nice',
      evidence: '',
      status: 'missing',
    },
  ],
};

function renderPage(path = '/jobs') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <JobsPage />
    </MemoryRouter>,
  );
}

async function openFirstJob(user: ReturnType<typeof userEvent.setup>) {
  const buttons = await screen.findAllByRole('button', { name: /view details/i });
  await user.click(buttons[0]!);
  return await screen.findByRole('dialog');
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listJobs.mockResolvedValue(SUMMARIES);
  api.getJob.mockResolvedValue(DETAIL);
  api.deleteJob.mockResolvedValue(undefined);
});

describe('the list', () => {
  it('shows every saved job with its score and date', async () => {
    renderPage();

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Frontend Engineer')).toBeInTheDocument();
    expect(within(table).getByText('Acme')).toBeInTheDocument();
    expect(within(table).getByText('72%')).toBeInTheDocument();
    expect(within(table).getByText('Data Analyst')).toBeInTheDocument();
    expect(within(table).getByText('41%')).toBeInTheDocument();
  });

  it('describes each match bar for screen readers, not colour alone', async () => {
    renderPage();

    await screen.findByRole('table');
    expect(screen.getByLabelText('72 percent general match')).toBeInTheDocument();
    expect(screen.getByLabelText('41 percent general match')).toBeInTheDocument();
  });

  it('shows the empty state with a link to Evaluate', async () => {
    api.listJobs.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText(/no evaluations yet/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /evaluate your first job/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('reports a failure to load the list', async () => {
    api.listJobs.mockRejectedValue(new ApiClientError(0, 'AI_UNAVAILABLE', 'Cannot reach server.'));
    renderPage();

    expect(await screen.findByRole('alert')).toHaveTextContent(/cannot reach server/i);
  });
});

describe('search', () => {
  it('queries the server with what was typed', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table');

    await user.type(screen.getByLabelText(/search/i), 'globex');

    await waitFor(() => expect(api.listJobs).toHaveBeenLastCalledWith('globex'));
  });

  it('shows a search-specific empty state', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('table');

    api.listJobs.mockResolvedValue([]);
    await user.type(screen.getByLabelText(/search/i), 'nothing');

    expect(await screen.findByText(/no jobs match “nothing”/i)).toBeInTheDocument();
    expect(screen.queryByText(/no evaluations yet/i)).not.toBeInTheDocument();
  });
});

describe('the detail modal', () => {
  it('opens with the full evaluation', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);

    expect(api.getJob).toHaveBeenCalledWith(7);
    expect(within(dialog).getByText(/frontend engineer · acme/i)).toBeInTheDocument();
    expect(within(dialog).getByText('72%')).toBeInTheDocument();
    expect(within(dialog).getByText(/strong react, weaker on testing/i)).toBeInTheDocument();
    expect(within(dialog).getByText('3+ years React')).toBeInTheDocument();
    expect(within(dialog).getByText('Playwright')).toBeInTheDocument();
  });

  it('is announced as a modal dialog with a name', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);

    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName(/frontend engineer · acme/i);
  });

  it('moves focus into the dialog when it opens', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);

    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
  });

  it('keeps the job description collapsed until asked for', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    const disclosure = within(dialog).getByText('Job description');

    expect(within(dialog).getByText(/full job description text/i)).not.toBeVisible();
    await user.click(disclosure);
    expect(within(dialog).getByText(/full job description text/i)).toBeVisible();
  });

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup();
    renderPage();

    const triggers = await screen.findAllByRole('button', { name: /view details/i });
    await user.click(triggers[0]!);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.activeElement).toBe(triggers[0]);
  });

  it('closes when the backdrop is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    const backdrop = dialog.parentElement!;

    await user.click(backdrop);

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays open when the dialog itself is clicked', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    await user.click(within(dialog).getByText(/strong react/i));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('closes with the Close button', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    await user.click(within(dialog).getByRole('button', { name: /^close$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('reports a failed detail fetch inside the dialog', async () => {
    const user = userEvent.setup();
    api.getJob.mockRejectedValue(new ApiClientError(404, 'NOT_FOUND', 'No saved job with id 7.'));
    renderPage();

    const dialog = await openFirstJob(user);

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/no saved job with id 7/i);
  });
});

describe('deleting', () => {
  it('asks for confirmation before deleting', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));

    expect(within(dialog).getByText(/delete this evaluation for good/i)).toBeInTheDocument();
    expect(api.deleteJob).not.toHaveBeenCalled();
  });

  it('can back out of the confirmation', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await user.click(within(dialog).getByRole('button', { name: /keep it/i }));

    expect(within(dialog).getByRole('button', { name: /^delete$/i })).toBeInTheDocument();
    expect(api.deleteJob).not.toHaveBeenCalled();
  });

  it('deletes, closes the dialog and drops the row from the list', async () => {
    const user = userEvent.setup();
    renderPage();

    const dialog = await openFirstJob(user);
    await user.click(within(dialog).getByRole('button', { name: /^delete$/i }));
    await user.click(within(dialog).getByRole('button', { name: /yes, delete/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.deleteJob).toHaveBeenCalledWith(7);
    expect(screen.queryByText('Frontend Engineer')).not.toBeInTheDocument();
    expect(screen.getByText('Data Analyst')).toBeInTheDocument();
  });
});

describe('the deep link from the Evaluate page', () => {
  it('opens the named job straight away', async () => {
    renderPage('/jobs?open=4');

    const dialog = await screen.findByRole('dialog');

    expect(api.getJob).toHaveBeenCalledWith(4);
    expect(dialog).toBeInTheDocument();
  });

  it('ignores a nonsense id', async () => {
    renderPage('/jobs?open=abc');

    await screen.findByRole('table');
    expect(api.getJob).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
