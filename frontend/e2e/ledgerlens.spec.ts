import { expect, test } from '@playwright/test'

test('money flows, CSV review, export safety and calendar boundaries', async ({
  page,
  request,
}) => {
  const nonce = Date.now().toString().slice(-8)
  const accountA = `QA origine ${nonce}`
  const accountB = `QA destinazione ${nonce}`
  const category = `QA categoria ${nonce}`
  const merchant = `QA spesa ${nonce}`
  const date = new Date().toISOString().slice(0, 10)
  const month = date.slice(0, 7)
  const errors: string[] = []
  const serverErrors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('response', (response) => {
    if (response.status() >= 500) serverErrors.push(`${response.status()} ${response.url()}`)
  })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()

  for (const name of [accountA, accountB]) {
    await page.getByRole('button', { name: '+ Conto' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabel('Nome').fill(name)
    await dialog.getByRole('button', { name: 'Salva' }).click()
    await expect(dialog).toBeHidden()
  }
  await page.getByRole('button', { name: '+ Categoria' }).click()
  await page.getByRole('dialog').getByLabel('Nome').fill(category)
  await page.getByRole('dialog').getByRole('button', { name: 'Salva' }).click()

  await page.getByRole('button', { name: 'Budget', exact: true }).click()
  await page.getByRole('button', { name: 'Budget', exact: false }).last().click()
  let dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importo (EUR)').fill('20.00')
  await dialog.getByLabel('Categoria').selectOption({ label: category })
  await dialog.getByRole('button', { name: 'Salva' }).click()
  await expect(page.getByText('20,00', { exact: false }).first()).toBeVisible()

  await page.getByRole('button', { name: 'Movimenti' }).click()
  await page.getByRole('button', { name: 'Movimento', exact: false }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importo (EUR)').fill('12.00')
  await dialog
    .getByRole('combobox', { name: 'Conto', exact: true })
    .selectOption({ label: accountA })
  await dialog.getByLabel('Categoria').selectOption({ label: category })
  await dialog.getByLabel('Merchant').fill(merchant)
  await dialog.getByRole('button', { name: 'Salva' }).click()
  await expect(page.getByText(merchant)).toBeVisible()

  await page.getByRole('button', { name: 'Movimento', exact: false }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Tipo').selectOption('refund')
  await dialog.getByLabel('Importo (EUR)').fill('2.00')
  await dialog
    .getByRole('combobox', { name: 'Conto', exact: true })
    .selectOption({ label: accountA })
  await dialog.getByLabel('Spesa collegata').selectOption({ index: 1 })
  await dialog.getByRole('button', { name: 'Salva' }).click()

  await page.getByRole('button', { name: 'Trasferimento' }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importo (EUR)').fill('5.00')
  await dialog.getByLabel('Conto di origine').selectOption({ label: accountA })
  await dialog.getByLabel('Conto di destinazione').selectOption({ label: accountB })
  await dialog.getByRole('button', { name: 'Salva' }).click()
  await expect(page.getByText('Trasferimento · in entrata').last()).toBeVisible()

  await page.getByRole('button', { name: 'Dashboard' }).click()
  await page
    .getByRole('region', { name: 'Filtri combinabili' })
    .getByRole('combobox', { name: 'Conto' })
    .selectOption({ label: accountA })
  const expenseCard = page.locator('.metric').filter({ hasText: 'Spesa netta' })
  await expect(expenseCard).toContainText('10,00')
  await expect(page.locator('.metric').filter({ hasText: 'Cash flow' })).toContainText('−10,00')
  await expect(page.locator('.metric').filter({ hasText: 'Saldo al termine' })).toContainText(
    '−15,00',
  )
  await page.getByRole('button', { name: 'Budget', exact: true }).click()
  await expect(page.locator('.budget-card').filter({ hasText: category })).toContainText('10,00')

  await page.getByRole('button', { name: 'Import / Export' }).click()
  const csvDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Scarica CSV' }).click()
  expect((await csvDownload).suggestedFilename()).toBe('spendflow.csv')
  const jsonDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Scarica JSON' }).click()
  expect((await jsonDownload).suggestedFilename()).toBe('spendflow.json')
  const csv = `date,kind,amount,currency,account,category,merchant,tags,note\n${date},expense,3.00,EUR,${accountA},${category},QA CSV,qa,valid\n${date},expense,3.00,EUR,${accountA},${category},QA CSV,qa,valid\n"bad,expense,4.00,EUR,${accountA},${category},QA bad,qa,invalid\n`
  await page
    .getByLabel('File CSV')
    .setInputFiles({ name: 'qa.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await page.getByRole('button', { name: 'Mostra preview' }).click()
  await expect(page.getByText('1 validi · 1 duplicati · 1 scartati')).toBeVisible()
  await page.getByRole('button', { name: 'Conferma 1 righe' }).click()
  await expect(page.getByText('1 importati, 1 saltati, 1 scartati')).toBeVisible()

  await page.getByRole('button', { name: 'Movimenti' }).click()
  await page.getByRole('button', { name: 'Movimento', exact: false }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importo (EUR)').fill('1.00')
  await dialog
    .getByRole('combobox', { name: 'Conto', exact: true })
    .selectOption({ label: accountA })
  await dialog.getByLabel('Categoria').selectOption({ label: category })
  await dialog.getByLabel('Merchant').fill('=SUM(1,1)')
  await dialog.getByRole('button', { name: 'Salva' }).click()
  await page.getByRole('button', { name: 'Import / Export' }).click()
  const exportResponse = await request.get(
    `/api/export/csv?start=${month}-01&end=${date}&currency=EUR`,
  )
  expect(exportResponse.ok()).toBeTruthy()
  expect(await exportResponse.text()).toContain("'=SUM(1,1)")
  const jsonResponse = await request.get(
    `/api/export/json?start=${month}-01&end=${date}&currency=EUR`,
  )
  expect(jsonResponse.ok()).toBeTruthy()
  expect(await jsonResponse.json()).toEqual(
    expect.arrayContaining([expect.objectContaining({ merchant: '=SUM(1,1)' })]),
  )

  const invalidCurrency = await request.post('/api/transactions', {
    data: { date, kind: 'expense', amount: '1.00', currency: 'CHF', account_id: 1, category_id: 1 },
  })
  expect(invalidCurrency.status()).toBe(422)
  await page.getByRole('button', { name: 'Dashboard' }).click()
  await page.getByLabel('Dal', { exact: true }).fill('2024-01-01')
  await page.getByLabel('Al', { exact: true }).fill('2024-01-31')
  await expect(page.getByText('Nessun movimento nel periodo')).toBeVisible()
  await page.getByLabel('Al', { exact: true }).fill('2026-01-31')
  await page.getByLabel('Dal', { exact: true }).fill('2025-12-01')
  await expect(page.getByRole('rowheader', { name: '2025-12' })).toBeVisible()
  await expect(page.getByRole('rowheader', { name: '2026-01' })).toBeVisible()
  await page.getByRole('button', { name: 'Reimposta filtri' }).click()
  await page.getByRole('button', { name: 'Movimenti' }).click()
  await page.getByRole('button', { name: 'Movimento', exact: false }).click()
  dialog = page.getByRole('dialog')
  await dialog.getByLabel('Importo (EUR)').fill('-1')
  expect(
    await dialog
      .getByLabel('Importo (EUR)')
      .evaluate((input) => (input as HTMLInputElement).validity.rangeUnderflow),
  ).toBe(true)
  await dialog.getByRole('button', { name: 'Annulla' }).click()
  await page.getByRole('button', { name: 'Budget', exact: true }).click()
  page.once('dialog', (confirmation) => void confirmation.accept())
  await page
    .locator('.category-list > div')
    .filter({ hasText: category })
    .getByRole('button', { name: 'Archivia' })
    .click()
  await expect(page.locator('.category-list > div').filter({ hasText: category })).toContainText(
    'archiviata',
  )
  await page.getByRole('button', { name: 'Movimenti' }).click()
  await expect(page.getByText(merchant)).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: merchant })).toContainText(category)
  expect(errors).toEqual([])
  expect(serverErrors).toEqual([])
})
