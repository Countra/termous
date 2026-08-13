const WEB_SOCKET_CONNECTING = 0
const WEB_SOCKET_OPEN = 1

const socketsWaitingForOpen = new WeakSet<WebSocket>()

export function retireWebSocket(socket: WebSocket) {
  if (socket.readyState === WEB_SOCKET_CONNECTING) {
    if (socketsWaitingForOpen.has(socket)) {
      return
    }
    socketsWaitingForOpen.add(socket)
    const closeAfterOpen = () => {
      socketsWaitingForOpen.delete(socket)
      socket.removeEventListener('close', stopWaiting)
      if (socket.readyState === WEB_SOCKET_OPEN) {
        socket.close()
      }
    }
    const stopWaiting = () => {
      socketsWaitingForOpen.delete(socket)
      socket.removeEventListener('open', closeAfterOpen)
    }
    socket.addEventListener('open', closeAfterOpen, { once: true })
    socket.addEventListener('close', stopWaiting, { once: true })
    return
  }
  if (socket.readyState === WEB_SOCKET_OPEN) {
    socket.close()
  }
}
