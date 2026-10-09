/**
 * Tests never touch the real Groq API or the real database file.
 * These are set before any module reads process.env.
 */
process.env.GROQ_API_KEY = 'test-key-not-real';
process.env.GROQ_MODEL = 'openai/gpt-oss-120b';
process.env.DB_PATH = ':memory:';
