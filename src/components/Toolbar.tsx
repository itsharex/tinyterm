import React from 'react'
import { ShieldCheck, Server } from 'lucide-react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useStore } from '../store'
import './Toolbar.css'

export function Toolbar() {
  const { openCredentialsModal, openHostsModal } = useStore()

  const handleDragStart = async (e: React.MouseEvent) => {
    e.preventDefault()
    try {
      const appWindow = getCurrentWindow()
      await appWindow.startDragging()
    } catch (error) {
      console.error('Failed to start dragging:', error)
    }
  }

  const handleDoubleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    try {
      const appWindow = getCurrentWindow()
      const isMaximized = await appWindow.isMaximized()
      if (isMaximized) {
        await appWindow.unmaximize()
      } else {
        await appWindow.maximize()
      }
    } catch (error) {
      console.error('Failed to toggle maximize:', error)
    }
  }

  return (
    <div 
      className="toolbar"
      onMouseDown={handleDragStart}
      onDoubleClick={handleDoubleClick}
    >
      <div className="toolbar-spacer" />
      <div className="toolbar-pill">
        <ToolbarBtn
          icon={<ShieldCheck size={12} strokeWidth={1.9} />}
          label="凭据"
          onClick={openCredentialsModal}
        />
        <div className="toolbar-divider" />
        <ToolbarBtn
          icon={<Server size={12} strokeWidth={1.9} />}
          label="主机"
          onClick={openHostsModal}
        />
      </div>
      <div className="toolbar-spacer" />
    </div>
  )
}

function ToolbarBtn({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button className="toolbar-btn" onClick={onClick}>
      <span className="toolbar-btn-icon">{icon}</span>
      <span className="toolbar-btn-label">{label}</span>
    </button>
  )
}