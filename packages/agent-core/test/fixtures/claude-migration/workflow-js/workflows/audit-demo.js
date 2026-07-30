export const meta = {
  name: 'audit-demo',
  description: 'Tiny golden workflow',
}

const listed = await agent('List one file name.', {
  schema: { type: 'object', required: ['files'], properties: { files: { type: 'array', items: { type: 'string' } } } },
})

const audits = await pipeline(listed.files, (file) =>
  agent(`Audit ${file}`, { label: file }),
)

return { audits }
