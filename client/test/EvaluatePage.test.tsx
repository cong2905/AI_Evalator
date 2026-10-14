import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { JobDetail } from '@app/shared';
import { EvaluatePage } from '../src/pages/EvaluatePage';
import { ApiClientError } from '../src/api';

const api = vi.hoisted(() => ({
  getDefaultResume: vi.fn(),
  parseResumeFile: vi.fn(),
  saveResume: vi.fn(),
  evaluate: vi.fn(),
  health: vi.fn(),
}));

vi.mock('../src/api', async () => {
  const actual = await vi.importActual<typeof import('../src/api')>('../src/api');
  return { ...actual, api };
});

const RESUME = 'Jane Doe, frontend engineer with React and TypeScript experience. '.repeat(5);
const JD =
  'We are hiring a Frontend Engineer. Required: 3+ years React, TypeScript and automated testing.';

const RESULT: JobDetail = {
  id: 7,
  jobName: 'Frontend Engineer',
  company: 'Acme',
  matchScore: 75,
  createdAt: '2026-10-11T10:00:00.000Z',
  summary: 'Good overall fit, weaker on automated testing.',
  missingKeywords: ['Playwright', 'design systems'],
  jdText: JD,
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
      requirement: 'Automated testing',
      category: 'tool',
      importance: 'must',
      evidence: 'Mentions unit tests',
      status: 'partial',
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

function renderPage() {
  return render(
    <MemoryRouter>
      <EvaluatePage />
    </MemoryRouter>,
  );
}

/** Fills the resume box and the whole job form with valid values. */
async function fillValidForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByLabelText(/paste resume text/i));
  await user.paste(RESUME);
  await user.click(screen.getByLabelText(/^job name$/i));
  await user.paste('Frontend Engineer');
  await user.click(screen.getByLabelText(/^company$/i));
  await user.paste('Acme');
  await user.click(screen.getByLabelText(/^job description$/i));
  await user.paste(JD);
}

const evaluateButton = () => screen.getByRole('button', { name: /evaluate with ai|evaluating|wait/i });

beforeEach(() => {
  vi.clearAllMocks();
  api.getDefaultResume.mockResolvedValue(null);
  api.saveResume.mockResolvedValue({
    id: 3,
    label: 'Pasted resume',
    content: RESUME,
    isDefault: true,
    updatedAt: '2026-10-11T10:00:00.000Z',
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the Evaluate button', () => {
  it('stays disabled until every field is valid', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);

    expect(evaluateButton()).toBeDisabled();

    await user.click(screen.getByLabelText(/^job name$/i));
    await user.paste('Frontend Engineer');
    expect(evaluateButton()).toBeDisabled();

    await fillValidForm(user);
    expect(evaluateButton()).toBeEnabled();
  });

  it('stays disabled while the job description is under 50 characters', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);

    await fillValidForm(user);
    await user.clear(screen.getByLabelText(/^job description$/i));
    await user.click(screen.getByLabelText(/^job description$/i));
    await user.paste('Too short to be a job description.');

    expect(evaluateButton()).toBeDisabled();
    expect(screen.getByText(/at least 50 needed/i)).toBeInTheDocument();
  });

  it('tells the user to add a resume when only the job form is filled', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);

    await user.click(screen.getByLabelText(/^job name$/i));
    await user.paste('Frontend Engineer');
    await user.click(screen.getByLabelText(/^company$/i));
    await user.paste('Acme');
    await user.click(screen.getByLabelText(/^job description$/i));
    await user.paste(JD);

    expect(screen.getByText(/add your resume on the left/i)).toBeInTheDocument();
    expect(evaluateButton()).toBeDisabled();
  });
});

describe('while evaluating', () => {
  it('shows the wait hint and locks the button', async () => {
    const user = userEvent.setup();
    let resolveEvaluation: (detail: JobDetail) => void = () => {};
    api.evaluate.mockReturnValue(
      new Promise<JobDetail>((resolve) => {
        resolveEvaluation = resolve;
      }),
    );

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    expect(await screen.findByText(/evaluating… \(usually 5–15 s\)/i)).toBeInTheDocument();
    expect(evaluateButton()).toBeDisabled();

    resolveEvaluation(RESULT);
    await waitFor(() => expect(evaluateButton()).toBeEnabled());
  });

  it('saves the resume first when "save as my default" is checked', async () => {
    const user = userEvent.setup();
    api.evaluate.mockResolvedValue(RESULT);

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    await screen.findByText(/3 · Comparison/i);
    expect(api.saveResume).toHaveBeenCalledWith(
      expect.objectContaining({ setDefault: true, text: RESUME }),
    );
    expect(api.evaluate).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'Frontend Engineer', company: 'Acme', resumeId: 3 }),
    );
  });

  it('sends the text inline when the user does not want it saved', async () => {
    const user = userEvent.setup();
    api.evaluate.mockResolvedValue(RESULT);

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(screen.getByLabelText(/save as my default resume/i));
    await user.click(evaluateButton());

    await screen.findByText(/3 · Comparison/i);
    expect(api.saveResume).not.toHaveBeenCalled();
    expect(api.evaluate).toHaveBeenCalledWith(expect.objectContaining({ resumeText: RESUME }));
  });
});

describe('the result', () => {
  beforeEach(() => {
    api.evaluate.mockResolvedValue(RESULT);
  });

  it('shows the score, summary, table and missing keywords', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.getByText(/good overall fit/i)).toBeInTheDocument();

    const table = screen.getByRole('table');
    expect(within(table).getByText('3+ years React')).toBeInTheDocument();
    expect(within(table).getByText('“Built React dashboards”')).toBeInTheDocument();
    // Nothing in the resume supports this one.
    expect(within(table).getByText('—')).toBeInTheDocument();

    expect(screen.getByText('Playwright')).toBeInTheDocument();
    expect(screen.getByText('design systems')).toBeInTheDocument();
  });

  it('labels every status in words, not colour alone', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Met')).toBeInTheDocument();
    expect(within(table).getByText('Partial')).toBeInTheDocument();
    expect(within(table).getByText('Missing')).toBeInTheDocument();
  });

  it('links to the saved job in the jobs database', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    const link = await screen.findByRole('link', { name: /open in jobs database/i });
    expect(link).toHaveAttribute('href', '/jobs?open=7');
  });
});

describe('errors', () => {
  it('counts down and re-enables the button when Groq is rate limited', async () => {
    const user = userEvent.setup();
    api.evaluate.mockRejectedValue(
      new ApiClientError(429, 'RATE_LIMITED', 'Groq is busy, try again in 3s', 3),
    );

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);

    // Typing is done; swap in fake timers and click without user-event, which
    // would need its own timer wiring.
    vi.useFakeTimers();
    fireEvent.click(evaluateButton());

    await vi.waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/groq is busy/i));
    expect(screen.getByRole('alert')).toHaveTextContent('3s');
    expect(evaluateButton()).toBeDisabled();

    await vi.advanceTimersByTimeAsync(1000);
    expect(screen.getByRole('alert')).toHaveTextContent('2s');

    await vi.advanceTimersByTimeAsync(2000);
    expect(evaluateButton()).toBeEnabled();
    expect(evaluateButton()).toHaveTextContent(/evaluate with ai/i);
  });

  it('shows a server error without clearing the form', async () => {
    const user = userEvent.setup();
    api.evaluate.mockRejectedValue(
      new ApiClientError(503, 'AI_UNAVAILABLE', 'Groq is having trouble right now.'),
    );

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());

    expect(await screen.findByRole('alert')).toHaveTextContent(/having trouble/i);
    expect(screen.getByLabelText(/^job description$/i)).toHaveValue(JD);
    expect(evaluateButton()).toBeEnabled();
  });

  it('recovers on a retry after an error', async () => {
    const user = userEvent.setup();
    api.evaluate
      .mockRejectedValueOnce(new ApiClientError(502, 'AI_BAD_OUTPUT', 'Bad output.'))
      .mockResolvedValueOnce(RESULT);

    renderPage();
    await screen.findByText(/no default resume saved yet/i);
    await fillValidForm(user);
    await user.click(evaluateButton());
    await screen.findByRole('alert');

    await user.click(evaluateButton());

    expect(await screen.findByText('75%')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('the resume panel', () => {
  it('loads the saved default on mount', async () => {
    api.getDefaultResume.mockResolvedValue({
      id: 1,
      label: 'sample-resume.pdf',
      content: RESUME,
      updatedAt: '2026-10-09T10:00:00.000Z',
    });

    renderPage();

    expect(await screen.findByText(/default loaded: sample-resume\.pdf/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/paste resume text/i)).toHaveValue(RESUME);
  });

  it('puts an uploaded file through the parser and into the textarea', async () => {
    const user = userEvent.setup();
    api.parseResumeFile.mockResolvedValue('Parsed resume text from the PDF');

    renderPage();
    await screen.findByText(/no default resume saved yet/i);

    const file = new File(['%PDF-1.4'], 'my-resume.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText(/upload pdf or docx/i), file);

    await waitFor(() =>
      expect(screen.getByLabelText(/paste resume text/i)).toHaveValue(
        'Parsed resume text from the PDF',
      ),
    );
    expect(api.parseResumeFile).toHaveBeenCalledWith(file);
  });
});
