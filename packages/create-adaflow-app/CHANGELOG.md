# create-adaflow-app

## 0.1.1

### Patch Changes

- 57ef7ee: A CLI agora resolve a versão mais recente do `@adaflow/sdk` no registry npm ao
  gerar o app, em vez de usar uma constante fixa — releases novos do SDK chegam
  aos apps gerados sem precisar republicar a CLI. Com o registry inacessível,
  cai no fallback `^0.1.0` (scaffold funciona offline).
