/** Every request carries the anonymous visitor session added by sessionMiddleware. */
declare global {
  namespace Express {
    interface Request {
      sessionId: string;
    }
  }
}

export {};
