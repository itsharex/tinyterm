import { useEffect, useState, useCallback } from 'react'
import { X, ChevronLeft, ChevronRight, Loader2, Cpu, Database, HardDrive } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import './SystemInfoModal.css'

export type QueryType = 'cpu' | 'memory' | 'disk'

interface Props {
  sessionId: string
  type: QueryType
  onClose: () => void
}

interface ProcessInfo {
  pid: string
  value: string
  name: string
  path: string
}

interface DiskInfo {
  filesystem: string
  size: string
  used: string
  avail: string
  usePercent: string
  mounted: string
}

const PAGE_SIZE = 15

const COMMANDS: Record<QueryType, { title: string; icon: React.ReactNode; cmd: string }> = {
  cpu: {
    title: 'CPU 占用情况',
    icon: <Cpu size={14} strokeWidth={2} />,
    cmd: `ps -eo pid,pcpu,comm,args | awk 'NR==1{next} {print}' | sort -k2 -nr | head -n 100`,
  },
  memory: {
    title: '内存占用情况',
    icon: <Database size={14} strokeWidth={2} />,
    cmd: `ps -eo pid,pmem,comm,args | awk 'NR==1{next} {print}' | sort -k2 -nr | head -n 100`,
  },
  disk: {
    title: '磁盘占用情况',
    icon: <HardDrive size={14} strokeWidth={2} />,
    cmd: `df -h`,
  },
}

function parseProcessOutput(output: string): ProcessInfo[] {
  const lines = output.trim().split('\n')
  const result: ProcessInfo[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    // Match: PID VALUE COMMAND rest-of-args
    const match = trimmed.match(/^(\d+)\s+([\d.]+)\s+(\S+)(.*)$/)
    if (!match) continue
    const [, pid, value, name, rest] = match
    let path = rest.trim()
    // If path starts with [ or is empty, show as '-'
    if (!path || path.startsWith('[')) {
      path = '-'
    }
    result.push({ pid, value, name, path })
  }
  return result
}

function parseDiskOutput(output: string): DiskInfo[] {
  const lines = output.trim().split('\n')
  const result: DiskInfo[] = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('Filesystem')) continue
    const parts = trimmed.split(/\s+/)
    if (parts.length < 6) continue
    result.push({
      filesystem: parts[0],
      size: parts[1],
      used: parts[2],
      avail: parts[3],
      usePercent: parts[4],
      mounted: parts.slice(5).join(' '),
    })
  }
  return result
}

export function SystemInfoModal({ sessionId, type, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [processData, setProcessData] = useState<ProcessInfo[]>([])
  const [diskData, setDiskData] = useState<DiskInfo[]>([])
  const [page, setPage] = useState(0)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setPage(0)
    try {
      const { cmd } = COMMANDS[type]
      const output = await invoke<string>('execute_remote_command', { sessionId, command: cmd })
      if (type === 'disk') {
        setDiskData(parseDiskOutput(output))
      } else {
        setProcessData(parseProcessOutput(output))
      }
    } catch (e: any) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [sessionId, type])

  useEffect(() => {
    loadData()
  }, [loadData])

  const config = COMMANDS[type]
  const isDisk = type === 'disk'
  const data = isDisk ? diskData : processData
  const totalPages = Math.max(1, Math.ceil(data.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages - 1)
  const start = currentPage * PAGE_SIZE
  const pageData = data.slice(start, start + PAGE_SIZE)

  const handlePrev = () => setPage(p => Math.max(0, p - 1))
  const handleNext = () => setPage(p => Math.min(totalPages - 1, p + 1))

  return (
    <div className="sysinfo-modal-overlay" onClick={onClose}>
      <div className="sysinfo-modal" onClick={e => e.stopPropagation()}>
        <div className="sysinfo-modal-header">
          <div className="sysinfo-modal-title">
            {config.icon}
            <span>{config.title}</span>
          </div>
          <div className="sysinfo-modal-actions">
            <button className="sysinfo-modal-refresh" onClick={loadData} disabled={loading} title="刷新">
              <Loader2 size={13} strokeWidth={2} className={loading ? 'spin' : ''} />
            </button>
            <button className="sysinfo-modal-close" onClick={onClose} title="关闭">
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        <div className="sysinfo-modal-body">
          {loading && (
            <div className="sysinfo-modal-loading">
              <Loader2 size={24} strokeWidth={2} className="spin" />
              <span>正在获取数据...</span>
            </div>
          )}

          {!loading && error && (
            <div className="sysinfo-modal-error">
              <span>获取失败: {error}</span>
            </div>
          )}

          {!loading && !error && data.length === 0 && (
            <div className="sysinfo-modal-empty">暂无数据</div>
          )}

          {!loading && !error && data.length > 0 && (
            <div className="sysinfo-table-wrapper">
              <table className="sysinfo-table">
                <thead>
                  <tr>
                    {isDisk ? (
                      <>
                        <th>文件系统</th>
                        <th>总容量</th>
                        <th>已用</th>
                        <th>可用</th>
                        <th>使用率</th>
                        <th>挂载点</th>
                      </>
                    ) : (
                      <>
                        <th>PID</th>
                        <th>{type === 'cpu' ? 'CPU%' : '内存%'}</th>
                        <th>程序名称</th>
                        <th>执行路径 / 参数</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {isDisk
                    ? (pageData as DiskInfo[]).map((row, i) => (
                        <tr key={i}>
                          <td className="cell-mono">{row.filesystem}</td>
                          <td className="cell-mono">{row.size}</td>
                          <td className="cell-mono">{row.used}</td>
                          <td className="cell-mono">{row.avail}</td>
                          <td className={`cell-mono ${parseInt(row.usePercent) > 80 ? 'cell-warn' : ''}`}>
                            {row.usePercent}
                          </td>
                          <td>{row.mounted}</td>
                        </tr>
                      ))
                    : (pageData as ProcessInfo[]).map((row, i) => (
                        <tr key={i}>
                          <td className="cell-mono">{row.pid}</td>
                          <td className="cell-mono">{row.value}</td>
                          <td className="cell-name">{row.name}</td>
                          <td className="cell-path" title={row.path}>{row.path}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && !error && data.length > 0 && (
          <div className="sysinfo-modal-footer">
            <span className="sysinfo-page-info">
              共 {data.length} 条 · 第 {currentPage + 1} / {totalPages} 页
            </span>
            <div className="sysinfo-page-btns">
              <button onClick={handlePrev} disabled={currentPage === 0}>
                <ChevronLeft size={14} />
              </button>
              <button onClick={handleNext} disabled={currentPage >= totalPages - 1}>
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
