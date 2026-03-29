import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AppDialogHost } from '../components/AppDialogHost'
import { useStore } from '../store'

describe('AppDialogHost', () => {
  beforeEach(() => {
    useStore.setState({ appDialog: null })
  })

  it('opens confirm dialog and resolves true on confirm', async () => {
    const resultPromise = useStore.getState().openConfirmDialog({
      title: 'Confirm title',
      message: 'Confirm message',
      confirmText: 'Yes',
      cancelText: 'No',
    })

    render(<AppDialogHost />)

    expect(screen.getByText('Confirm title')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))

    await expect(resultPromise).resolves.toBe(true)
    expect(useStore.getState().appDialog).toBeNull()
  })

  it('opens confirm dialog and resolves false on cancel', async () => {
    const resultPromise = useStore.getState().openConfirmDialog({
      title: 'Delete',
      message: 'Are you sure?',
      confirmText: 'Delete',
      cancelText: 'Cancel',
    })

    render(<AppDialogHost />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await expect(resultPromise).resolves.toBe(false)
    expect(useStore.getState().appDialog).toBeNull()
  })
})
