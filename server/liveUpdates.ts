import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

let revision = crypto.randomUUID();
const clients = new Set<Response>();
export const getPlanningRevision = () => revision;
export function planningEvents(req: Request, res: Response) {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify({ revision })}\n\n`);
  clients.add(res); send();
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
  req.on('close', () => { clearInterval(heartbeat); clients.delete(res); });
}
export function planningChanges(req: Request, res: Response, next: NextFunction) {
  const planningPath = /^\/(helpers|sections|streets|settings|database)(\/|$)/.test(req.path);
  const mutates = planningPath && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)
    && !['/helpers/reconcile-stations', '/settings/smtp-password'].includes(req.path);
  if (!mutates) return next();
  const expected = req.get('X-Planning-Revision');
  if (expected && expected !== revision) return res.status(409).json({ error: 'Die Planung wurde inzwischen geändert. Ihre Eingabe wurde nicht gespeichert. Bitte schließen Sie die Bearbeitung, prüfen Sie den aktuellen Stand und versuchen Sie es erneut.' });
  const json = res.json.bind(res);
  res.json = ((body: unknown) => {
    if (res.statusCode < 400) {
      revision = crypto.randomUUID();
      res.setHeader('X-Planning-Revision', revision);
      const result = json(body);
      for (const client of clients) client.write(`data: ${JSON.stringify({ revision })}\n\n`);
      return result;
    }
    return json(body);
  }) as Response['json'];
  next();
}
