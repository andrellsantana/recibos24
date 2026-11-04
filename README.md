# Recibo S-24

App web (PWA) para preencher o formulário **S-24-T** na tela, assinar em **dois aparelhos diferentes** e gerar o PDF para o WhatsApp.
Sem servidor, sem login e sem banco de dados: tudo roda no navegador.

## Como funciona
1. **Preenchido por** (aparelho A): preenche, toca em *Assinar*. O app gera um QR Code ou um link para o WhatsApp.
2. **Conferido por** (aparelho B): aponta a câmera para o QR Code ou abre o link, confere e assina. Pode **cancelar** se houver erro.
3. O aparelho B gera o PDF validado, sobre o `S-24_T.pdf` original, e compartilha.

- Cada aparelho cria uma chave digital própria (ECDSA P-256) no 1º uso; só se digita o nome.
- O app recusa a conferência se a chave for a mesma de quem preencheu.
- Se os dados forem alterados depois da 1ª assinatura, a assinatura fica inválida e a conferência é bloqueada.
- Tipo padrão **Donativo**; **Depósito no cofre** bloqueado; **Pagamento**/**Adiantamento** pedem confirmação.
- Valores `1.234,56` (sem R$); data `dd-mm-aaaa`; total automático.

## Publicar (GitHub Pages)
Settings → Pages → Branch `main`, pasta `/ (root)`. Precisa de HTTPS (a criptografia do navegador exige).

## Rodar localmente
```bash
python3 -m http.server 8000
```
Abra http://localhost:8000
