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
- Valores `1.234,56` (sem R$); data `dd/mm/aaaa`; total automático.
- Valores negativos (ex.: `-10,00`) em vermelho, na tela e no PDF. Para pôr o sinal, toque em **± negativo** ou digite `-`.
- Total acima de **999,99** pede confirmação de quem preenche e aparece como alerta para quem confere.
- Celular **em pé**: tocar num campo abre uma caixa grande para digitar. Deitado (e no tablet ou computador), digita-se direto no formulário.
- **Conferir: ler QR Code** lê o código pela câmera dentro do app. No Android usa o leitor do próprio Chrome; nos outros, uma biblioteca que só é carregada nessa hora.

## Publicar (GitHub Pages)
Settings → Pages → Branch `main`, pasta `/ (root)`. Precisa de HTTPS (a criptografia do navegador exige).

## Rodar localmente
```bash
python3 -m http.server 8000
```
Abra http://localhost:8000

## Endereço fixo do app (importante)
Os dados do recibo **viajam dentro do link** (QR Code ou WhatsApp); não ficam guardados em servidor:

```
https://andrellsantana.github.io/recibos24/#r=eyJ2IjoxLCJpZCI6...
└──────────── endereço do app ──────────┘ └─ dados + assinatura ─┘
```

- Todos devem usar o app **no mesmo endereço**. O nome e a chave de cada aparelho ficam guardados *naquele endereço*.
- **Não mude o endereço** depois de começar a usar: renomear o repositório ou trocar de usuário no GitHub muda o endereço. Aí todos precisam digitar o nome de novo, e os recibos que ainda aguardavam conferência precisam ser refeitos. PDFs já validados não são afetados.
- Precisa ser `https://`, porque a assinatura digital do navegador exige isso.
- Endereço próprio (ex.: `recibos.suacongregacao.com.br`) é possível; configure **antes** de todos começarem a usar.

## Funciona sem internet?
- **1º acesso: precisa de internet.** Cada aparelho abre o app uma vez com internet, para ele ficar guardado no celular.
- Depois disso, **preencher, assinar, conferir pelo QR Code e gerar o PDF funcionam sem internet**.
- Só o **envio pelo WhatsApp** precisa de internet, e pode ser feito depois. O PDF fica salvo no aparelho, ou basta tocar em "Compartilhar PDF" de novo quando houver rede.
- No iPhone, o app instalado na tela inicial e o Safari guardam os dados separados. Por isso, use sempre o mesmo (de preferência o instalado).

## Validados aguardando envio
Na tela inicial de quem conferiu aparece a lista dos recibos validados que ainda não foram enviados. Ela fica guardada só naquele aparelho.
- **Enviar**: gera o PDF de novo e abre o compartilhamento (WhatsApp).
- Ao compartilhar, o recibo sai da lista sozinho. Se o PDF foi só baixado, toque em **Já enviei** (ou **Marcar como enviado**).
- Recibos enviados há mais de 60 dias são apagados do aparelho.

## Verificação automática das assinaturas
- Antes de gerar qualquer PDF, o app confere as duas assinaturas. Se algo não bater, o PDF não é gerado.
- **Verificar PDF** (no topo): escolha um PDF recebido e o app diz se é autêntico e mostra os dados assinados, para comparar com o PDF.
- **Android** (app instalado): no WhatsApp, compartilhe o PDF com o app **Recibo S-24** e a verificação abre sozinha. O iPhone/iPad não permite isso; use **Verificar PDF**.
