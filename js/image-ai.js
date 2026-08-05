/* ===========================
   ImageAI — motor compartilhado de edição/geração de imagem por IA.

   Existe porque a mesma operação ("pega a foto REAL do produto e devolve
   outra versão dela") é usada em lugares diferentes: Estúdio (padrões de
   criativo, cenários) e página de Produto (capa, melhorar qualidade,
   produto em uso). Antes disso a lógica vivia só no studio.js e não
   suportava dimensão exata nem saída em WebP.

   O que a doc oficial dos provedores garante (verificado em 03/08/2026):

   - NENHUM dos dois faz upscale determinístico com API key. A OpenAI não tem
     endpoint de upscale; o Google tem (imagen-4.0-upscale-preview) mas só no
     Vertex AI, que exige service account — inviável num app 100% browser.
     Logo, "melhorar qualidade" aqui é RE-SÍNTESE guiada por prompt: o modelo
     redesenha a foto. Por isso todo prompt daqui carrega instrução forte de
     preservação, e a UI sempre mostra antes/depois pro usuário poder recusar.

   - OpenAI /v1/images/edits: só o gpt-image-2 aceita size arbitrário
     (WIDTHxHEIGHT). Regras: cada lado múltiplo de 16, lado máximo 3840,
     razão entre 1:3 e 3:1, e total de pixels entre 655.360 e 8.294.400.
     Os modelos anteriores só aceitam 1024x1024 / 1536x1024 / 1024x1536.
     output_format aceita png|jpeg|webp e output_compression 0-100.
     input_fidelity:"high" é o que preserva o produto — mas NÃO pode ser
     enviado ao gpt-image-2, que já opera sempre em alta fidelidade.

   - Gemini: devolve só PNG/JPEG (não tem WebP na saída) — a conversão é
     feita aqui no browser. Omitir aspectRatio faz o modelo seguir a
     proporção da imagem de referência, que é o que queremos ao melhorar
     uma foto existente. Toda imagem sai com marca d'água SynthID.
   =========================== */

const ImageAI = (() => {

    // ── Limites do gpt-image-2, da doc oficial ──
    const OA_MIN_PX = 655360;
    const OA_MAX_PX = 8294400;
    const OA_MAX_LADO = 3840;
    const OA_PASSO = 16;

    // Fallback: gpt-image-2 aceita dimensão livre; os outros, só as fixas.
    const MODELOS_OPENAI = ['gpt-image-2', 'gpt-image-1.5', 'gpt-image-1'];
    const TAMANHOS_FIXOS = ['1024x1024', '1536x1024', '1024x1536'];

    // Ordem de tentativa no Google. O 2.5-flash-image tem desligamento
    // anunciado para 02/10/2026, então fica só como último recurso.
    const MODELOS_GEMINI = ['gemini-3-pro-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

    function _chaveOpenAI() {
        return (window.AIAdGenerator?._getKey?.('openai')) || localStorage.getItem('openai_api_key') || '';
    }
    function _chaveGoogle() {
        return (window.AIAdGenerator?._getKey?.('google')) || localStorage.getItem('google_ai_api_key') || '';
    }

    // Traduz uma dimensão desejada para a mais próxima que o gpt-image-2
    // aceita. `alvoPixels` permite pedir uma render MAIOR que o original de
    // propósito (supersampling): gerar grande e reduzir depois no canvas dá
    // um resultado mais nítido do que gerar já no tamanho final.
    function tamanhoValidoOpenAI(largura, altura, alvoPixels) {
        const lOrig = Math.max(1, Number(largura) || 1024);
        const aOrig = Math.max(1, Number(altura) || 1024);
        // Razão fora de 1:3..3:1 é rejeitada pela API — grampeia antes.
        const razao = Math.min(3, Math.max(1 / 3, lOrig / aOrig));

        let px = Number(alvoPixels) || (lOrig * aOrig);
        px = Math.min(OA_MAX_PX, Math.max(OA_MIN_PX, px));

        let a = Math.sqrt(px / razao);
        let l = a * razao;

        const maior = Math.max(l, a);
        if (maior > OA_MAX_LADO) { const k = OA_MAX_LADO / maior; l *= k; a *= k; }

        const passo = (v) => Math.max(OA_PASSO, Math.round(v / OA_PASSO) * OA_PASSO);
        l = passo(l); a = passo(a);

        // O arredondamento pode furar o piso/teto de pixels — ajusta de 16 em 16.
        let guarda = 0;
        while (l * a < OA_MIN_PX && guarda++ < 200) {
            if (Math.max(l, a) + OA_PASSO > OA_MAX_LADO) break;
            if (l >= a) { l += OA_PASSO; a = passo(l / razao); }
            else { a += OA_PASSO; l = passo(a * razao); }
        }
        guarda = 0;
        while (l * a > OA_MAX_PX && guarda++ < 200) {
            if (l <= OA_PASSO || a <= OA_PASSO) break;
            if (l >= a) { l -= OA_PASSO; a = passo(l / razao); }
            else { a -= OA_PASSO; l = passo(a * razao); }
        }
        l = Math.min(OA_MAX_LADO, Math.max(OA_PASSO, l));
        a = Math.min(OA_MAX_LADO, Math.max(OA_PASSO, a));
        return { largura: l, altura: a, texto: `${l}x${a}` };
    }

    // Escolhe o tamanho fixo mais parecido (modelos que não aceitam livre).
    function _tamanhoFixoMaisProximo(largura, altura) {
        const razao = (Number(largura) || 1) / (Number(altura) || 1);
        let melhor = TAMANHOS_FIXOS[0], dif = Infinity;
        for (const t of TAMANHOS_FIXOS) {
            const [l, a] = t.split('x').map(Number);
            const d = Math.abs((l / a) - razao);
            if (d < dif) { dif = d; melhor = t; }
        }
        return melhor;
    }

    async function _blobParaBase64(blob) {
        return await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onloadend = () => resolve(String(r.result || '').split(',')[1] || '');
            r.onerror = () => reject(new Error('Falha ao ler a imagem'));
            r.readAsDataURL(blob);
        });
    }

    function _b64ParaBlob(b64, tipo = 'image/png') {
        const bytes = atob(b64);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
        return new Blob([arr], { type: tipo });
    }

    // ── OpenAI ────────────────────────────────────────────────────────
    async function _editarOpenAI(blobs, prompt, opcoes = {}) {
        const chave = opcoes.apiKey || _chaveOpenAI();
        if (!chave) throw new Error('Configure a chave OpenAI em Chaves de API');
        const lista = Array.isArray(blobs) ? blobs.filter(Boolean) : [blobs];
        if (!lista.length) throw new Error('Nenhuma imagem de entrada');

        const querLivre = !!(opcoes.largura && opcoes.altura);
        const tamanhoLivre = querLivre
            ? tamanhoValidoOpenAI(opcoes.largura, opcoes.altura, opcoes.alvoPixels).texto
            : null;

        let ultimoErro = '';
        for (const modelo of MODELOS_OPENAI) {
            // Só o gpt-image-2 aceita dimensão arbitrária; nos demais cai no
            // tamanho fixo mais próximo e o chamador reenquadra no canvas.
            const size = (modelo === 'gpt-image-2' && tamanhoLivre)
                ? tamanhoLivre
                : (querLivre ? _tamanhoFixoMaisProximo(opcoes.largura, opcoes.altura) : (opcoes.size || '1024x1024'));

            const fd = new FormData();
            fd.append('model', modelo);
            if (lista.length > 1) lista.forEach((b, i) => fd.append('image[]', b, `img${i + 1}.png`));
            else fd.append('image', lista[0], 'produto.png');
            fd.append('prompt', prompt);
            fd.append('size', size);
            fd.append('n', '1');
            // WebP direto da API evita um reencode a mais no browser.
            if (opcoes.formato) {
                const fmt = String(opcoes.formato).replace('image/', '');
                fd.append('output_format', fmt);
                if (fmt === 'webp' || fmt === 'jpeg') {
                    fd.append('output_compression', String(opcoes.compressao ?? 85));
                }
            }
            // A doc é explícita: o gpt-image-2 recusa este parâmetro (já opera
            // sempre em alta fidelidade); nos demais o default é "low", que
            // reinterpreta o produto em vez de preservá-lo.
            if (modelo !== 'gpt-image-2') fd.append('input_fidelity', 'high');

            const r = await fetch('https://api.openai.com/v1/images/edits', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + chave },
                body: fd,
            });
            if (!r.ok) {
                ultimoErro = (await r.text()).slice(0, 260);
                // Modelo indisponível para a conta: tenta o próximo da lista.
                if (r.status === 400 || r.status === 403 || r.status === 404) continue;
                throw new Error('OpenAI: ' + ultimoErro);
            }
            const data = await r.json();
            const b64 = data?.data?.[0]?.b64_json;
            if (!b64) throw new Error('OpenAI: resposta sem imagem');
            const tipo = opcoes.formato ? String(opcoes.formato) : 'image/png';
            return _b64ParaBlob(b64, tipo);
        }
        throw new Error('OpenAI: nenhum modelo de imagem disponível para esta chave. ' + ultimoErro);
    }

    // ── Google Gemini ─────────────────────────────────────────────────
    async function _editarGemini(blobs, prompt, opcoes = {}) {
        const chave = _chaveGoogle();
        if (!chave) throw new Error('Configure a chave Google AI em Chaves de API');
        const lista = Array.isArray(blobs) ? blobs.filter(Boolean) : [blobs];
        if (!lista.length) throw new Error('Nenhuma imagem de entrada');

        // Exemplos oficiais multi-imagem põem as IMAGENS antes do texto, pra
        // "first/second image" no prompt casar com a ordem enviada.
        const parts = [];
        for (const b of lista) {
            parts.push({ inline_data: { mime_type: b.type || 'image/png', data: await _blobParaBase64(b) } });
        }
        parts.push({ text: prompt });

        // Sem aspectRatio o modelo segue a proporção da referência (bom pra
        // melhorar/reaproveitar). Mas quando o chamador PEDE uma proporção
        // (reenquadrar pra story/16:9/4:3), passamos explícito.
        const imageConfig = { imageSize: opcoes.imageSize || '2K' };
        if (opcoes.aspectRatio) imageConfig.aspectRatio = opcoes.aspectRatio;

        let ultimoErro = '';
        for (const modelo of MODELOS_GEMINI) {
            const r = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/${modelo}:generateContent?key=${chave}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts }],
                    generationConfig: { responseModalities: ['IMAGE'], imageConfig },
                }),
            });
            if (!r.ok) {
                ultimoErro = (await r.text()).slice(0, 260);
                if (r.status === 404 || r.status === 403 || r.status === 400) continue;
                throw new Error('Gemini: ' + ultimoErro);
            }
            const data = await r.json();
            const partes = data?.candidates?.[0]?.content?.parts || [];
            const img = partes.find(p => p.inlineData?.data || p.inline_data?.data);
            const b64 = img?.inlineData?.data || img?.inline_data?.data;
            if (b64) return _b64ParaBlob(b64, img?.inlineData?.mimeType || 'image/png');
            // Respondeu só texto (recusa/segurança): o motivo importa mais do
            // que tentar outro modelo, que responderia igual.
            const txt = partes.map(p => p.text).filter(Boolean).join(' ').slice(0, 180);
            throw new Error('Gemini não devolveu imagem' + (txt ? `: ${txt}` : '.'));
        }
        throw new Error('Gemini: nenhum modelo de imagem disponível para esta chave. ' + ultimoErro);
    }

    function provedorPadrao() {
        return localStorage.getItem('studio_img_provider') || 'auto';
    }

    function _temChave(prov) {
        return prov === 'gemini' ? !!_chaveGoogle() : !!_chaveOpenAI();
    }

    // Entrada única. `opcoes.largura/altura` pedem a saída já na dimensão
    // desejada — só a OpenAI honra de verdade; o Gemini segue a proporção da
    // imagem de referência e o ajuste fino de pixel fica por conta do canvas
    // do chamador (é também assim que a saída JPEG do Gemini vira WebP).
    //
    // 'auto' tenta o Gemini primeiro e cai pra OpenAI no que o Google não
    // atender (sem chave, modelo indisponível para a conta, ou recusa).
    async function editar(blobs, prompt, opcoes = {}) {
        const escolhido = opcoes.provedor || provedorPadrao();

        if (escolhido !== 'auto') {
            return escolhido === 'gemini'
                ? _editarGemini(blobs, prompt, opcoes)
                : _editarOpenAI(blobs, prompt, opcoes);
        }

        const ordem = ['gemini', 'openai'].filter(_temChave);
        if (!ordem.length) throw new Error('Configure a chave do Google AI ou da OpenAI em Chaves de API');

        let ultimoErro;
        for (const prov of ordem) {
            try {
                return prov === 'gemini'
                    ? await _editarGemini(blobs, prompt, opcoes)
                    : await _editarOpenAI(blobs, prompt, opcoes);
            } catch (e) {
                ultimoErro = e;
                console.warn(`[ImageAI] ${prov} falhou, tentando o próximo:`, e.message);
            }
        }
        throw ultimoErro || new Error('Nenhum provedor conseguiu gerar a imagem');
    }

    // ── Prompts ───────────────────────────────────────────────────────

    // Restauração. Descreve em detalhe o que NÃO pode mudar porque nenhum dos
    // provedores preserva pixel a pixel — a recomendação oficial dos dois é
    // justamente enumerar no texto o que deve permanecer igual.
    function promptMelhoria(contexto = '') {
        const ctx = String(contexto || '').trim();
        // A frase "Keep everything else in the image exactly the same,
        // preserving the original style, lighting, and composition" é o
        // template literal que o Google publica para edição preservando o
        // resto — nenhum modelo garante pixel a pixel, então dizer isso no
        // texto é o único mecanismo que os dois provedores oferecem.
        return `Using the provided image, improve ONLY its technical quality.`
            + ` Remove JPEG compression artefacts, colour banding, noise and blur; recover fine detail in materials, edges, stitching and printed text; improve sharpness and colour accuracy.`
            + ` Keep everything else in the image exactly the same, preserving the original style, lighting, and composition.`
            + ` This is a RESTORATION of an existing photograph, not a new image:`
            + ` the product must remain completely unchanged — identical shape, proportions, colour, materials, branding, logos, text and markings — in the identical position, angle, framing, crop and background as the input image.`
            + ` Do not restyle it, do not re-light the scene, do not re-crop or zoom, do not add or remove any element, and do not add any text or logo that is not already visible in the input.`
            + (ctx ? ` The product is: ${ctx}.` : '');
    }

    // Produto em uso / apoiado sobre algo. `sobre` é o texto livre do usuário.
    function promptCenario(sobre, contexto = '') {
        const alvo = String(sobre || '').trim();
        const ctx = String(contexto || '').trim();
        return `Photorealistic commercial product photograph showing this exact product ${alvo || 'in natural use'}.`
            + ` High-resolution, studio-quality lighting with realistic shadows, reflections and contact points where the product touches the surface, sharp focus on the product.`
            + ` The product itself must remain completely unchanged — identical shape, proportions, colour, materials, branding, logos, text and markings as in the input image.`
            + ` Do not add any text, logo, badge or label that is not already visible on the product in the input image.`
            + (ctx ? ` The product is: ${ctx}.` : '');
    }

    // Composição com uma FOTO DE CENÁRIO que o usuário subiu: coloca o produto
    // dentro daquela cena. Segue o padrão de "combining multiple images" das
    // docs — os papéis vão separados no TEXTO ("first/second image"), que é o
    // único mecanismo que os provedores dão pra distinguir cena de sujeito.
    function promptCenaImagem(contexto = '') {
        const ctx = String(contexto || '').trim();
        return `Use the two provided images. THE FIRST IMAGE is a reference scene/environment that was originally made for a DIFFERENT brand. THE SECOND IMAGE is the real product.`
            + ` Create one photorealistic commercial photograph placing the product from the second image naturally into the scene of the first image:`
            + ` correct scale and perspective, lighting, shadows and reflections that match the scene, and realistic contact where the product rests on or is held in the scene.`
            + ` The product must remain completely unchanged — identical shape, proportions, colour, materials, branding, logos, text and markings as in the second image.`
            + ` CRITICAL — clean the scene's branding: remove or replace EVERY brand name, logo, emblem, watermark, sticker and promotional text that appears anywhere in the first image (on boxes, packaging, cases, cloths, lens tags, backgrounds, banners or props).`
            + ` The ONLY brand allowed anywhere in the final image is the product's own brand, exactly as it appears on the product in the second image.`
            + ` Never keep any brand from the first image — for example a car manufacturer or any company unrelated to the product. Do not invent new text or logos that are not the product's own.`
            + (ctx ? ` The product is: ${ctx}.` : '');
    }

    // Traduz o texto DENTRO de uma imagem (banners de descrição) mantendo o
    // layout. Same-dimensions é garantido pelo canvas do chamador; aqui a
    // instrução é só trocar o idioma do texto sem mexer em mais nada.
    function promptTraducaoImagem(idiomaEn) {
        return `Using the provided image, translate every piece of visible written text into ${idiomaEn}.`
            + ` Keep everything else in the image EXACTLY the same — layout, composition, the product, colours, logos, fonts, text position, background and dimensions must not change.`
            + ` Only the human-readable text changes language. Do not translate brand names, model names or trademarks.`
            + ` Match the original font style, size, colour and position as closely as possible so the layout stays intact.`;
    }

    // Reenquadra um criativo já pronto para outra proporção/tamanho SEM mudar
    // o conteúdo — é como o mesmo criativo vira story, 16:9, 4:3 etc. e continua
    // idêntico. Outpainting: estende o fundo, nunca corta/distorce o produto.
    function promptReframe() {
        return `Reframe this exact image to the new canvas/aspect ratio without changing its content.`
            + ` Keep the product, its position and size, the overall composition, colours, lighting and style IDENTICAL to the input image — this must look like the same creative, only in a different format.`
            + ` Extend the existing background naturally (outpainting) to fill the new area. Do NOT crop, stretch, distort, zoom or duplicate the product, and do not add any new text, logo or element.`;
    }

    return {
        editar, provedorPadrao, tamanhoValidoOpenAI,
        promptMelhoria, promptCenario, promptCenaImagem, promptTraducaoImagem, promptReframe,
        _blobParaBase64, _b64ParaBlob, _tamanhoFixoMaisProximo,
        MODELOS_OPENAI, MODELOS_GEMINI,
    };
})();

window.ImageAI = ImageAI;
