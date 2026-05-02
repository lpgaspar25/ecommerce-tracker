/* ===========================
   Region Tags — extrai e padroniza códigos de país/idioma de nomes de campanha
   Pode ser usada em múltiplas regiões: "EUA + UK" → "EUA+UK"
   =========================== */

const RegionTags = {
    // Padrões individuais. A função `extract` coleta TODOS que casam, depois
    // ordena/junta com '+' pra gerar uma chave canônica multi-região.
    PATTERNS: [
        // Tag de mercado/idioma: EN agrupa Reino Unido + Irlanda + Austrália
        // (mercados de língua inglesa que o usuário roda numa única campanha).
        // É tratado como código próprio — não explode em UK/IE/AU automaticamente.
        { code: 'EN',  label: '<i data-lucide="languages" style="width:12px;height:12px;vertical-align:-2px"></i> Reino Unido + Irlanda + Austrália',
          re: /\bEN\b/i },
        { code: 'EUA', label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Estados Unidos',
          re: /\b(?:EUA|USA|ESTADOS\s*UNIDOS|UNITED\s*STATES)\b/i },
        { code: 'UK',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Reino Unido',
          re: /\b(?:UK|REINO\s*UNIDO|UNITED\s*KINGDOM|GB|GREAT\s*BRITAIN)\b/i },
        { code: 'IE',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Irlanda',
          re: /\b(?:IE|IRLANDA|IRELAND)\b/i },
        { code: 'AU',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Austrália',
          re: /\b(?:AU|AUSTR[AÁ]LIA|AUSTRALIA)\b/i },
        { code: 'NZ',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Nova Zelândia',
          re: /\b(?:NZ|NOVA\s*ZEL[AÂ]NDIA|NEW\s*ZEALAND)\b/i },
        { code: 'CA',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Canadá',
          re: /\b(?:CA|CANAD[ÁA]|CANADA)\b/i },
        { code: 'DE',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Alemanha',
          re: /\b(?:DE|ALEMANHA|GERMANY|DEUTSCHLAND)\b/i },
        { code: 'IT',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Itália',
          re: /\b(?:IT|IT[AÁ]LIA|ITALY|ITALIA)\b/i },
        { code: 'FR',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> França',
          re: /\b(?:FR|FRAN[ÇC]A|FRANCE)\b/i },
        { code: 'ES',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Espanha',
          re: /\b(?:ES|ESPANHA|SPAIN)\b/i },
        { code: 'PT',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Portugal',
          re: /\bPORTUGAL\b/i },
        { code: 'NL',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Holanda',
          re: /\b(?:NL|HOLANDA|NETHERLANDS|NEDERLAND)\b/i },
        { code: 'BE',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Bélgica',
          re: /\b(?:BE|B[ÉE]LGICA|BELGIUM)\b/i },
        { code: 'CH',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Suíça',
          re: /\b(?:CH|SU[IÍ][ÇC]A|SWITZERLAND)\b/i },
        { code: 'AT',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Áustria',
          re: /\b(?:AT|[ÁA]USTRIA|AUSTRIA)\b/i },
        { code: 'BR',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> Brasil',
          re: /\b(?:BR|BRASIL|BRAZIL)\b/i },
        { code: 'MX',  label: '<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> México',
          re: /\b(?:MX|M[ÉE]XICO|MEXICO)\b/i },
    ],

    // "EU+" significa Europa+ (multi-país sem especificação)
    EU_PLUS_RE: /\bEU\s*\+|\bEUROPA\s*\+|\bEUROPE\s*\+/i,

    // Extrai a região canônica do nome da campanha. Retorna string (vazia se nada bater).
    // Múltiplas regiões viram uma chave ordenada com '+': "EUA+UK", "AU+UK".
    extract(campaignName) {
        if (!campaignName) return '';
        const name = String(campaignName);
        const found = new Set();
        for (const { code, re } of this.PATTERNS) {
            if (re.test(name)) found.add(code);
        }
        if (found.size === 0) {
            // Tenta detectar "EU+" como wildcard se nada específico bateu
            if (this.EU_PLUS_RE.test(name)) return 'EU+';
            return '';
        }
        return Array.from(found).sort().join('+');
    },

    // Label legível para uma região (suporta multi). Retorna HTML com ícones.
    label(code) {
        if (!code) return '<span style="color:var(--text-muted)">Sem região</span>';
        if (code === 'EU+') return '<i data-lucide="globe" style="width:12px;height:12px;vertical-align:-2px"></i> Europa+';
        const parts = code.split('+');
        return parts.map(c => {
            const def = this.PATTERNS.find(p => p.code === c);
            return def ? def.label : `<i data-lucide="flag" style="width:12px;height:12px;vertical-align:-2px"></i> ${c}`;
        }).join(' + ');
    },

    // Versão texto-puro do label (para selects/headers sem HTML)
    labelPlain(code) {
        if (!code) return 'Sem região';
        if (code === 'EU+') return 'Europa+';
        const parts = code.split('+');
        const names = {
            EN: 'UK+IE+AU',
            EUA: 'Estados Unidos', UK: 'Reino Unido', IE: 'Irlanda', AU: 'Austrália',
            NZ: 'Nova Zelândia', CA: 'Canadá', DE: 'Alemanha', IT: 'Itália', FR: 'França',
            ES: 'Espanha', PT: 'Portugal', NL: 'Holanda', BE: 'Bélgica', CH: 'Suíça',
            AT: 'Áustria', BR: 'Brasil', MX: 'México',
        };
        return parts.map(c => names[c] || c).join(' + ');
    },

    // Lista de todas as regiões únicas presentes no diário (para popular filtros)
    listFromDiary(diary = []) {
        const set = new Set();
        diary.forEach(d => { if (d.region) set.add(d.region); });
        return Array.from(set).sort();
    },

    // Extrai o "interesse" (audience target) do nome da campanha.
    // Heurística: o bracket imediatamente após o tag de país/idioma é o interesse,
    // desde que não seja data, código curto (CBO/RE/TC01/GT02/TP/etc) ou nota de
    // performance (1V19CPA, 120>240, REATIVADO, etc).
    extractInterest(campaignName) {
        if (!campaignName) return '';
        const brackets = [];
        const re = /\[([^\]]+)\]/g;
        let m;
        while ((m = re.exec(String(campaignName))) !== null) {
            brackets.push(m[1].trim());
        }
        if (!brackets.length) return '';

        // Find country/language bracket
        let countryIdx = -1;
        for (let i = 0; i < brackets.length; i++) {
            if (this.extract(`[${brackets[i]}]`)) { countryIdx = i; break; }
        }
        if (countryIdx < 0) return '';

        const isDate = (s) => /^\s*\d{1,2}[./-]\d{1,2}/.test(s);
        const isPerf = (s) => /\d+\s*V\d+|>|CPA|REATIV[AO]|R\$|\$\d|^\d+$/i.test(s);
        const isShortCode = (s) => /^(?:CBO|ABO|RE|EN|TP|TC[-\s\d]*|GT[-\s\d]*|RR|FB|MB|ALL|TC-ALL)$/i.test(s.trim());

        for (let i = countryIdx + 1; i < brackets.length; i++) {
            const b = brackets[i];
            if (isDate(b) || isPerf(b) || isShortCode(b)) continue;
            return b;
        }
        return '';
    },
};
