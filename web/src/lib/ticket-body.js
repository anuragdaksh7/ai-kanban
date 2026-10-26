// Shared field builder for ticket create/update forms (dialog + drawer).
export function buildTicketBody(form) {
  const body = {
    content: form.content,
    agent: form.agent,
    worktree: form.worktree,
    tldr: form.tldr,
    sessionCode: form.sessionCode,
    decisionsPending: form.decisionsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    metadata: form.metadataText.trim() ? JSON.parse(form.metadataText) : {},
  }
  if (form.issueNumber !== '') {
    body.issueNumber = Number(form.issueNumber)
    if (!Number.isInteger(body.issueNumber) || body.issueNumber <= 0) {
      throw new Error('issue number must be a positive integer')
    }
  }
  if (form.prNumber !== '') {
    body.prNumber = Number(form.prNumber)
    if (!Number.isInteger(body.prNumber) || body.prNumber <= 0) {
      throw new Error('PR number must be a positive integer')
    }
  }
  // eslint-disable-next-line no-undef
  if (body.metadata && (typeof body.metadata !== 'object' || Array.isArray(body.metadata))) {
    // eslint-disable-next-line no-undef
    throw new Error('metadata must be a JSON object')
  }
  return body
}
