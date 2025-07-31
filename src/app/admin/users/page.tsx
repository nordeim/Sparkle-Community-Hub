// src/app/admin/users/page.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { 
  Search, 
  Filter, 
  MoreVertical, 
  Shield, 
  Ban, 
  Mail,
  UserX,
  UserCheck,
  Download,
  Upload,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  UserPlus,
  Settings,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Trophy,
  MessageSquare,
  FileText,
  Eye,
  Edit,
  Trash2,
  Send,
  Gift,
  Sparkles
} from 'lucide-react'
import { api } from '@/lib/api'
import { UserDetailsDialog } from '@/components/admin/user-details-dialog'
import { BulkActionsDialog } from '@/components/admin/bulk-actions-dialog'
import { UserEditDialog } from '@/components/admin/user-edit-dialog'
import { formatDate, formatNumber } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/components/ui/use-toast'

type SortField = 'username' | 'email' | 'createdAt' | 'level' | 'posts' | 'followers'
type SortOrder = 'asc' | 'desc'
type UserRole = 'USER' | 'MODERATOR' | 'ADMIN' | 'CREATOR'
type UserStatus = 'all' | 'active' | 'verified' | 'banned' | 'new'

interface FilterState {
  search: string
  role: UserRole | 'all'
  status: UserStatus
  level: { min?: number; max?: number }
  dateRange: { start?: Date; end?: Date }
}

export default function UsersManagementPage() {
  const [filterState, setFilterState] = useState<FilterState>({
    search: '',
    role: 'all',
    status: 'all',
    level: {},
    dateRange: {},
  })
  
  const [sortField, setSortField] = useState<SortField>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [selectedUsers, setSelectedUsers] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [page, setPage] = useState(1)
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [editingUser, setEditingUser] = useState<string | null>(null)
  const [bulkAction, setBulkAction] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ action: string; userId: string } | null>(null)

  const debouncedSearch = useDebounce(filterState.search, 300)

  const { data, isLoading, refetch } = api.admin.getUsers.useQuery({
    search: debouncedSearch,
    role: filterState.role === 'all' ? undefined : filterState.role,
    status: filterState.status,
    levelMin: filterState.level.min,
    levelMax: filterState.level.max,
    dateStart: filterState.dateRange.start,
    dateEnd: filterState.dateRange.end,
    sortField,
    sortOrder,
    page,
    limit: 50,
  })

  const banUser = api.admin.banUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User banned successfully' })
      refetch()
    },
  })

  const unbanUser = api.admin.unbanUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User unbanned successfully' })
      refetch()
    },
  })

  const verifyUser = api.admin.verifyUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User verified successfully' })
      refetch()
    },
  })

  const changeUserRole = api.admin.changeUserRole.useMutation({
    onSuccess: () => {
      toast({ title: 'User role updated successfully' })
      refetch()
    },
  })

  const deleteUser = api.admin.deleteUser.useMutation({
    onSuccess: () => {
      toast({ title: 'User deleted successfully' })
      refetch()
    },
  })

  const grantCurrency = api.admin.grantCurrency.useMutation({
    onSuccess: () => {
      toast({ title: 'Currency granted successfully' })
      refetch()
    },
  })

  const exportUsers = api.admin.exportUsers.useMutation()

  const handleAction = useCallback(async (action: string, userId: string, data?: any) => {
    switch (action) {
      case 'ban':
        await banUser.mutateAsync({ userId, reason: data?.reason })
        break
      case 'unban':
        await unbanUser.mutateAsync({ userId })
        break
      case 'verify':
        await verifyUser.mutateAsync({ userId })
        break
      case 'make_admin':
        await changeUserRole.mutateAsync({ userId, role: 'ADMIN' })
        break
      case 'make_moderator':
        await changeUserRole.mutateAsync({ userId, role: 'MODERATOR' })
        break
      case 'make_creator':
        await changeUserRole.mutateAsync({ userId, role: 'CREATOR' })
        break
      case 'remove_role':
        await changeUserRole.mutateAsync({ userId, role: 'USER' })
        break
      case 'delete':
        await deleteUser.mutateAsync({ userId })
        break
      case 'grant_sparkle_points':
        await grantCurrency.mutateAsync({ 
          userId, 
          amount: data?.amount || 0,
          type: 'sparkle_points',
          reason: data?.reason 
        })
        break
    }
    setConfirmAction(null)
  }, [banUser, unbanUser, verifyUser, changeUserRole, deleteUser, grantCurrency])

  const handleBulkAction = useCallback(async (action: string, data?: any) => {
    const userIds = Array.from(selectedUsers)
    
    switch (action) {
      case 'ban':
        await Promise.all(userIds.map(id => banUser.mutateAsync({ userId: id, reason: data?.reason })))
        break
      case 'verify':
        await Promise.all(userIds.map(id => verifyUser.mutateAsync({ userId: id })))
        break
      case 'send_email':
        // Handle bulk email
        break
      case 'grant_currency':
        await Promise.all(userIds.map(id => grantCurrency.mutateAsync({
          userId: id,
          amount: data?.amount || 0,
          type: data?.type || 'sparkle_points',
          reason: data?.reason
        })))
        break
    }
    
    setSelectedUsers(new Set())
    setBulkAction(null)
    refetch()
  }, [selectedUsers, banUser, verifyUser, grantCurrency, refetch])

  const handleExport = useCallback(async () => {
    const result = await exportUsers.mutateAsync({
      filters: filterState,
      format: 'csv'
    })
    
    // Download the exported file
    const blob = new Blob([result.data], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `users-export-${new Date().toISOString()}.csv`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filterState, exportUsers])

  const handleSort = useCallback((field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
  }, [sortField])

  const handleSelectAll = useCallback((checked: boolean) => {
    if (checked && data?.users) {
      setSelectedUsers(new Set(data.users.map(u => u.id)))
    } else {
      setSelectedUsers(new Set())
    }
  }, [data])

  const handleSelectUser = useCallback((userId: string, checked: boolean) => {
    const newSelection = new Set(selectedUsers)
    if (checked) {
      newSelection.add(userId)
    } else {
      newSelection.delete(userId)
    }
    setSelectedUsers(newSelection)
  }, [selectedUsers])

  const getRoleBadge = (role: string) => {
    const config = {
      ADMIN: { variant: 'destructive' as const, icon: Shield },
      MODERATOR: { variant: 'secondary' as const, icon: Shield },
      CREATOR: { variant: 'default' as const, icon: CheckCircle },
      USER: { variant: 'outline' as const, icon: null },
    }
    
    const { variant, icon: Icon } = config[role as UserRole] || config.USER
    
    return (
      <Badge variant={variant} className="gap-1">
        {Icon && <Icon className="w-3 h-3" />}
        {role}
      </Badge>
    )
  }

  const getStatusBadge = (user: any) => {
    if (user.banned) {
      return <Badge variant="destructive" className="gap-1">
        <Ban className="w-3 h-3" />
        Banned
      </Badge>
    }
    if (user.verified) {
      return <Badge variant="default" className="gap-1">
        <CheckCircle className="w-3 h-3" />
        Verified
      </Badge>
    }
    const daysSinceJoined = Math.floor((Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    if (daysSinceJoined < 7) {
      return <Badge variant="secondary" className="gap-1">
        <Clock className="w-3 h-3" />
        New
      </Badge>
    }
    return <Badge variant="outline">Active</Badge>
  }

  const stats = useMemo(() => {
    if (!data) return null
    
    return {
      total: data.total,
      verified: data.stats.verified,
      banned: data.stats.banned,
      newThisWeek: data.stats.newThisWeek,
      activeToday: data.stats.activeToday,
    }
  }, [data])

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">User Management</h1>
          <p className="text-muted-foreground">
            Manage users, roles, and permissions
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExport}>
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
          <Button size="sm">
            <UserPlus className="w-4 h-4 mr-2" />
            Invite User
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Users</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.total)}</p>
                </div>
                <Users className="w-8 h-8 text-muted-foreground" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Verified</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.verified)}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Banned</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.banned)}</p>
                </div>
                <Ban className="w-8 h-8 text-red-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">New This Week</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.newThisWeek)}</p>
                </div>
                <UserPlus className="w-8 h-8 text-blue-500" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Active Today</p>
                  <p className="text-2xl font-bold">{formatNumber(stats.activeToday)}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Users</CardTitle>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Search users..."
                  value={filterState.search}
                  onChange={(e) => setFilterState(prev => ({ ...prev, search: e.target.value }))}
                  className="pl-10 w-[300px]"
                />
              </div>
              
              <Select value={filterState.role} onValueChange={(value) => setFilterState(prev => ({ ...prev, role: value as any }))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All roles</SelectItem>
                  <SelectItem value="USER">User</SelectItem>
                  <SelectItem value="CREATOR">Creator</SelectItem>
                  <SelectItem value="MODERATOR">Moderator</SelectItem>
                  <SelectItem value="ADMIN">Admin</SelectItem>
                </SelectContent>
              </Select>

              <Select value={filterState.status} onValueChange={(value) => setFilterState(prev => ({ ...prev, status: value as UserStatus }))}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="All status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="verified">Verified</SelectItem>
                  <SelectItem value="banned">Banned</SelectItem>
                  <SelectItem value="new">New</SelectItem>
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="w-4 h-4" />
              </Button>

              {selectedUsers.size > 0 && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      Bulk Actions ({selectedUsers.size})
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setBulkAction('verify')}>
                      <CheckCircle className="w-4 h-4 mr-2" />
                      Verify Users
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('ban')}>
                      <Ban className="w-4 h-4 mr-2" />
                      Ban Users
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('send_email')}>
                      <Mail className="w-4 h-4 mr-2" />
                      Send Email
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setBulkAction('grant_currency')}>
                      <Gift className="w-4 h-4 mr-2" />
                      Grant Currency
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={selectedUsers.size === data?.users.length && data?.users.length > 0}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('username')}
                  >
                    User {sortField === 'username' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('email')}
                  >
                    Email {sortField === 'email' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead 
                    className="cursor-pointer text-center"
                    onClick={() => handleSort('level')}
                  >
                    Level {sortField === 'level' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="text-center">Stats</TableHead>
                  <TableHead 
                    className="cursor-pointer"
                    onClick={() => handleSort('createdAt')}
                  >
                    Joined {sortField === 'createdAt' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8">
                      <RefreshCw className="w-6 h-6 animate-spin mx-auto" />
                    </TableCell>
                  </TableRow>
                ) : data?.users.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  data?.users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedUsers.has(user.id)}
                          onCheckedChange={(checked) => handleSelectUser(user.id, checked as boolean)}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="w-8 h-8">
                            <AvatarImage src={user.image || undefined} />
                            <AvatarFallback>{user.username[0].toUpperCase()}</AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-medium">{user.username}</p>
                            {user.onlineStatus && (
                              <p className="text-xs text-green-500">Online</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {user.email}
                      </TableCell>
                      <TableCell>{getRoleBadge(user.role)}</TableCell>
                      <TableCell>{getStatusBadge(user)}</TableCell>
                      <TableCell className="text-center">
                        <div className="flex items-center justify-center gap-2">
                          <Trophy className="w-4 h-4 text-yellow-500" />
                          <span className="font-medium">{user.level}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-center gap-4 text-sm">
                          <div className="flex items-center gap-1">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span>{user._count.posts}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-4 h-4 text-muted-foreground" />
                            <span>{user._count.followers}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <Sparkles className="w-4 h-4 text-sparkle-500" />
                            <span>{formatNumber(user.sparklePoints)}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => setSelectedUser(user.id)}>
                              <Eye className="w-4 h-4 mr-2" />
                              View Details
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditingUser(user.id)}>
                              <Edit className="w-4 h-4 mr-2" />
                              Edit User
                            </DropdownMenuItem>
                            <DropdownMenuItem>
                              <Mail className="w-4 h-4 mr-2" />
                              Send Email
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            
                            {/* Role Management */}
                            <DropdownMenuLabel className="text-xs">Role Management</DropdownMenuLabel>
                            {user.role !== 'ADMIN' && (
                              <DropdownMenuItem onClick={() => handleAction('make_admin', user.id)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Make Admin
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'MODERATOR' && (
                              <DropdownMenuItem onClick={() => handleAction('make_moderator', user.id)}>
                                <Shield className="w-4 h-4 mr-2" />
                                Make Moderator
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'CREATOR' && (
                              <DropdownMenuItem onClick={() => handleAction('make_creator', user.id)}>
                                <CheckCircle className="w-4 h-4 mr-2" />
                                Make Creator
                              </DropdownMenuItem>
                            )}
                            {user.role !== 'USER' && (
                              <DropdownMenuItem onClick={() => handleAction('remove_role', user.id)}>
                                <UserX className="w-4 h-4 mr-2" />
                                Remove Role
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuSeparator />
                            
                            {/* User Actions */}
                            {!user.verified && (
                              <DropdownMenuItem onClick={() => handleAction('verify', user.id)}>
                                <UserCheck className="w-4 h-4 mr-2" />
                                Verify User
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuItem onClick={() => setBulkAction('grant_currency')}>
                              <Gift className="w-4 h-4 mr-2" />
                              Grant Currency
                            </DropdownMenuItem>
                            
                            {user.banned ? (
                              <DropdownMenuItem onClick={() => handleAction('unban', user.id)}>
                                <UserCheck className="w-4 h-4 mr-2" />
                                Unban User
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem 
                                onClick={() => setConfirmAction({ action: 'ban', userId: user.id })}
                                className="text-destructive"
                              >
                                <Ban className="w-4 h-4 mr-2" />
                                Ban User
                              </DropdownMenuItem>
                            )}
                            
                            <DropdownMenuSeparator />
                            
                            <DropdownMenuItem 
                              onClick={() => setConfirmAction({ action: 'delete', userId: user.id })}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete User
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {/* Pagination */}
          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-muted-foreground">
                Showing {((page - 1) * 50) + 1} to {Math.min(page * 50, data.total)} of {data.total} users
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(prev => Math.max(1, prev - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="w-4 h-4" />
                  Previous
                </Button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(5, data.totalPages) }, (_, i) => {
                    const pageNum = page - 2 + i
                    if (pageNum < 1 || pageNum > data.totalPages) return null
                    return (
                      <Button
                        key={pageNum}
                        variant={pageNum === page ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setPage(pageNum)}
                        className="w-8 h-8 p-0"
                      >
                        {pageNum}
                      </Button>
                    )
                  }).filter(Boolean)}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage(prev => Math.min(data.totalPages, prev + 1))}
                  disabled={page === data.totalPages}
                >
                  Next
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      {selectedUser && (
        <UserDetailsDialog
          userId={selectedUser}
          onClose={() => setSelectedUser(null)}
          onAction={handleAction}
        />
      )}

      {editingUser && (
        <UserEditDialog
          userId={editingUser}
          onClose={() => setEditingUser(null)}
          onSave={() => {
            setEditingUser(null)
            refetch()
          }}
        />
      )}

      {bulkAction && (
        <BulkActionsDialog
          action={bulkAction}
          userCount={selectedUsers.size}
          onConfirm={handleBulkAction}
          onCancel={() => setBulkAction(null)}
        />
      )}

      {/* Confirmation Dialog */}
      <AlertDialog open={!!confirmAction} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Action</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction?.action === 'ban' && 'Are you sure you want to ban this user? They will not be able to access their account.'}
              {confirmAction?.action === 'delete' && 'Are you sure you want to delete this user? This action cannot be undone and will permanently remove all their data.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmAction && handleAction(confirmAction.action, confirmAction.userId)}
              className={confirmAction?.action === 'delete' ? 'bg-destructive text-destructive-foreground' : ''}
            >
              {confirmAction?.action === 'ban' ? 'Ban User' : 'Delete User'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
