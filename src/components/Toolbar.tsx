import React from 'react'
import { ShieldCheck, Server } from 'lucide-react'
import { useStore } from '../store'
import './Toolbar.css'

export function Toolbar() {
  const { openCredentialsModal, openHostsModal } = useStore()

  return (
    <div className="toolbar">
      <div className="toolbar-pill">
        <ToolbarBtn
          icon={<ShieldCheck size={14} strokeWidth={1.8} />}
          label="凭据"
          onClick={openCredentialsModal}
        />
        <div className="toolbar-divider" />
        <ToolbarBtn
          icon={<Server size={14} strokeWidth={1.8} />}
          label="主机"
          onClick={openHostsModal}
        />
      </div>
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