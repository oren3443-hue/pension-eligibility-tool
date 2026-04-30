interface WorkbookRow {
  [key: string]: string | number | boolean | null
}

export async function exportRowsToWorkbook(
  rows: WorkbookRow[],
  fileName: string,
  sheetName: string,
): Promise<void> {
  const xlsx = await import('xlsx')
  const runtime = (xlsx.default ?? xlsx) as typeof xlsx
  const worksheet = runtime.utils.json_to_sheet(rows)
  const workbook = runtime.utils.book_new()
  runtime.utils.book_append_sheet(workbook, worksheet, sheetName)

  const buffer = runtime.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
  })

  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(link.href)
}
