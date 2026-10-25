const BASE = '/api/v1'

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    let message = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // not JSON
    }
    throw new Error(message)
  }
  return res.json()
}

export const api = {
  listTickets: async () => {
    const data = await request('/tickets')
    return data.tickets ?? []
  },
  createTicket: (fields) =>
    request('/tickets', { method: 'POST', body: JSON.stringify(fields) }),
  updateTicket: (id, fields) =>
    request(`/tickets/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
  finishTicket: (id) =>
    request(`/tickets/${id}/finish`, { method: 'POST' }),
  listFeedback: async () => {
    const data = await request('/feedback')
    return data.feedback ?? []
  },
  createFeedback: (fields) =>
    request('/feedback', { method: 'POST', body: JSON.stringify(fields) }),
}
