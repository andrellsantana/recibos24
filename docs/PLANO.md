# Recibo S-24 — Mapeamento e plano

## Mapeamento do S-24-T (05/21)
PDF de 1 página, 396×234 pt (≈14×8,3 cm, paisagem). **Não tem campos AcroForm** — é um PDF "achatado"; o preenchimento será feito sobrepondo texto nas coordenadas abaixo (ou redesenhando o formulário em HTML/PDF).

| # | Campo | Tipo | Observação |
|---|-------|------|------------|
| 1 | Tipo | escolha (4 caixas) | Donativo, Depósito no cofre, Pagamento, Adiantamento |
| 2 | Data | data | dd/mm/aaaa |
| 3 | Donativos — Obra mundial | valor (R$) | |
| 4 | Donativos — Despesas da congregação local | valor (R$) | |
| 5–7 | Linhas livres 1, 2, 3 | descrição + valor (R$) | |
| 8 | TOTAL | valor (R$) | calculado automaticamente (soma de 3–7) |
| 9 | Preenchido por | nome + assinatura | pessoa A, dispositivo A |
| 10 | Conferido por | nome + assinatura | pessoa B ≠ A, dispositivo B |
| — | Rodapé fixo | "S-24-T 05/21" | |

Status do recibo: Rascunho → Aguardando conferência → **Validado** (só após as 2 assinaturas).

## Decisões (rodada 2)
- Uma congregação; **sem login, sem senha, sem banco de dados, sem servidor**.
- Só gera PDF (sem histórico). Correção = novo recibo.
- Comunicação aparelho↔aparelho **por QR Code** (funciona offline, Android e iOS). Alternativa: link pelo WhatsApp.
- Identidade: cada aparelho cria uma chave criptográfica (Web Crypto, ECDSA P-256) no primeiro uso + nome da pessoa. Sem cadastro.
- Assinatura: (a) traço com o dedo, (b) nome + assinatura digital da chave, ou (c) ambas — **a definir**.

## Fluxo
1. A preenche e assina → app mostra QR com dados + assinatura digital de A.
2. B escaneia com a câmera → vê o recibo, confere, assina (bloqueado se a chave for a mesma de A).
3. B gera o PDF final "VALIDADO" com QR de verificação embutido → compartilha no WhatsApp.

## Etapas
1. Formulário idêntico ao S-24 + total automático + PDF (pdf-lib sobre o S-24_T.pdf original).
2. Assinatura (traço e/ou chave do aparelho).
3. Troca por QR Code (gerar + ler pela câmera) e validação das duas assinaturas.
4. PDF final com selo e QR de verificação; compartilhar via WhatsApp.
5. PWA instalável/offline; publicação gratuita (GitHub Pages).
