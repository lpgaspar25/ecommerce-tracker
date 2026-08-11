import { env } from '../config.js';
import { logger } from '../lib/logger.js';
export class EmailNotifier {
    isEnabled() {
        return !!(env.ALERT_EMAIL_TO && env.ALERT_EMAIL_FROM && env.EMAIL_PROVIDER_API_KEY);
    }
    async sendFailureAlert(run) {
        if (!this.isEnabled()) {
            logger.warn('Alerta de email não enviado: variáveis de email não configuradas.');
            return;
        }
        const subject = `[GoogleAds Sync] Falhas no run ${run.runId}`;
        const text = [
            `Run ID: ${run.runId}`,
            `Modo: ${run.mode}`,
            `TriggeredBy: ${run.triggeredBy}`,
            `Início: ${run.startedAt}`,
            `Fim: ${run.finishedAt}`,
            `Rows Read: ${run.rowsRead}`,
            `Rows Processed: ${run.rowsProcessed}`,
            `Rows Success: ${run.rowsSuccess}`,
            `Rows Failed: ${run.rowsFailed}`,
            `Status: ${run.status}`,
            `Erro: ${run.errorSummary || 'N/A'}`
        ].join('\n');
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.EMAIL_PROVIDER_API_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                personalizations: [{ to: [{ email: env.ALERT_EMAIL_TO }] }],
                from: { email: env.ALERT_EMAIL_FROM },
                subject,
                content: [{ type: 'text/plain', value: text }]
            })
        });
        if (!response.ok) {
            const details = await response.text().catch(() => 'sem detalhes');
            throw new Error(`Falha ao enviar email de alerta: HTTP ${response.status} ${details}`);
        }
        logger.info(`Alerta de falha enviado para ${env.ALERT_EMAIL_TO}.`);
    }
}
