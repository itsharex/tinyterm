import { useState } from 'react'
import { Command, X, Cpu, HardDrive, Database, Terminal } from 'lucide-react'
import { SystemInfoModal, type QueryType } from './SystemInfoModal'
import './TerminalQuickActions.css'

interface Props {
  sessionId: string
  onWrite: (data: string) => void
  fmOpen?: boolean
}

interface CommandItem {
  label: string
  command: string
  description?: string
}

interface CommandCategory {
  title: string
  items: CommandItem[]
}

const COMMAND_CATEGORIES: CommandCategory[] = [
  {
    title: '服务管理',
    items: [
      { label: '查看服务状态', command: 'systemctl status ' },
      { label: '启动服务', command: 'systemctl start ' },
      { label: '停止服务', command: 'systemctl stop ' },
      { label: '重启服务', command: 'systemctl restart ' },
      { label: '重载服务', command: 'systemctl reload ' },
      { label: '启用开机自启', command: 'systemctl enable ' },
      { label: '禁用开机自启', command: 'systemctl disable ' },
      { label: '查看运行中服务', command: 'systemctl list-units --type=service --state=running' },
      { label: '查看失败服务', command: 'systemctl list-units --failed' },
      { label: '查看服务日志', command: 'journalctl -u ' },
      { label: '实时跟踪日志', command: 'journalctl -u  -f' },
      { label: '查看最近日志', command: 'journalctl -n 50' },
    ],
  },
  {
    title: '进程管理',
    items: [
      { label: '按名称查进程', command: 'ps -ef | grep ' },
      { label: '按名称精确查进程', command: 'pgrep -a ' },
      { label: '按名称杀进程', command: 'pkill -9 ' },
      { label: '按PID杀进程', command: 'kill -9 ' },
      { label: '查看进程树', command: 'pstree -p ' },
      { label: '查看进程详情', command: 'ps aux | grep ' },
      { label: '查看端口占用进程', command: 'lsof -i :' },
      { label: '查看文件占用进程', command: 'lsof ' },
      { label: '查看进程打开的文件', command: 'lsof -p ' },
      { label: '优雅终止进程', command: 'kill -15 ' },
    ],
  },
  {
    title: '网络诊断',
    items: [
      { label: '查看监听端口', command: 'netstat -tlnp' },
      { label: '查看套接字状态', command: 'ss -tlnp' },
      { label: '测试连通性', command: 'ping -c 4 ' },
      { label: '路由追踪', command: 'traceroute ' },
      { label: '查看外网IP', command: 'curl -s ip.sb' },
      { label: 'HTTP请求头', command: 'curl -I -L --max-time 10 ' },
      { label: 'DNS查询', command: 'dig +short ' },
      { label: '查看路由表', command: 'ip route' },
      { label: '查看网络接口', command: 'ip addr' },
      { label: '抓包过滤', command: 'tcpdump -i any -nn host ' },
    ],
  },
  {
    title: '文件与磁盘',
    items: [
      { label: '查看目录大小', command: 'du -sh ' },
      { label: '查找大文件', command: 'du -ah . | sort -rh | head -n 20' },
      { label: '查找空目录', command: 'find . -type d -empty' },
      { label: '按名称查找文件', command: 'find . -name ' },
      { label: '查找最近修改文件', command: 'find . -type f -mtime -1' },
      { label: '压缩目录', command: 'tar -czvf archive.tar.gz ' },
      { label: '解压tar.gz', command: 'tar -xzvf ' },
      { label: '查看文件编码', command: 'file ' },
      { label: '清空日志文件', command: '> ' },
      { label: '查看文件前N行', command: 'head -n 50 ' },
      { label: '查看文件后N行', command: 'tail -n 50 -f ' },
      { label: '统计代码行数', command: 'wc -l ' },
    ],
  },
  {
    title: '系统与权限',
    items: [
      { label: '查看系统负载', command: 'uptime' },
      { label: '查看系统信息', command: 'uname -a' },
      { label: '查看当前用户', command: 'whoami' },
      { label: '查看用户信息', command: 'id' },
      { label: '查看登录用户', command: 'who' },
      { label: '添加执行权限', command: 'chmod +x ' },
      { label: '递归改权限', command: 'chmod -R 755 ' },
      { label: '递归改属主', command: 'chown -R $(whoami):$(whoami) ' },
      { label: '查看环境变量', command: 'env | grep ' },
      { label: '查看定时任务', command: 'crontab -l' },
      { label: '查看已安装包', command: 'rpm -qa | grep ' },
    ],
  },
]

export function TerminalQuickActions({ sessionId, onWrite, fmOpen }: Props) {
  const [open, setOpen] = useState(false)
  const [sysInfoType, setSysInfoType] = useState<QueryType | null>(null)

  const handleInput = (cmd: string) => {
    onWrite(cmd)
  }

  const handleOpenSysInfo = (type: QueryType) => {
    setSysInfoType(type)
  }

  const handleCloseSysInfo = () => {
    setSysInfoType(null)
  }

  return (
    <>
      <div className="quick-actions-wrapper">
        {!open ? (
          <button
            className="quick-actions-toggle"
            onClick={() => setOpen(true)}
            title="快捷指令"
          >
            <Command size={13} strokeWidth={2} />
          </button>
        ) : (
          <div className={`quick-actions-panel${fmOpen ? ' fm-open' : ''}`}>
            <div className="quick-actions-header">
              <span className="quick-actions-title">
                <Terminal size={11} strokeWidth={2} />
                快捷指令
              </span>
              <button
                className="quick-actions-close"
                onClick={() => setOpen(false)}
                title="收起"
              >
                <X size={12} strokeWidth={2.5} />
              </button>
            </div>

            <div className="quick-actions-section">
              <div className="quick-actions-section-title">系统速查（弹窗展示）</div>
              <div className="quick-actions-buttons">
                <button
                  className="quick-action-btn"
                  onClick={() => handleOpenSysInfo('cpu')}
                  title="查看 CPU 占用及各进程详情"
                >
                  <Cpu size={11} strokeWidth={2} />
                  CPU
                </button>
                <button
                  className="quick-action-btn"
                  onClick={() => handleOpenSysInfo('memory')}
                  title="查看内存占用及各进程详情"
                >
                  <Database size={11} strokeWidth={2} />
                  内存
                </button>
                <button
                  className="quick-action-btn"
                  onClick={() => handleOpenSysInfo('disk')}
                  title="查看磁盘占用情况"
                >
                  <HardDrive size={11} strokeWidth={2} />
                  磁盘
                </button>
              </div>
            </div>

            <div className="quick-actions-section">
              <div className="quick-actions-section-title">常用指令（双击输入）</div>
              <div className="quick-actions-scroll">
                {COMMAND_CATEGORIES.map(cat => (
                  <div key={cat.title} className="quick-actions-cat">
                    <div className="quick-actions-cat-title">{cat.title}</div>
                    <div className="quick-actions-cat-items">
                      {cat.items.map(item => (
                        <div
                          key={item.label}
                          className="quick-actions-item"
                          onDoubleClick={() => handleInput(item.command)}
                          title={item.description || `双击输入: ${item.command}`}
                        >
                          <code className="quick-actions-item-cmd">{item.command}</code>
                          <span className="quick-actions-item-label">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {sysInfoType && (
        <SystemInfoModal
          sessionId={sessionId}
          type={sysInfoType}
          onClose={handleCloseSysInfo}
        />
      )}
    </>
  )
}
