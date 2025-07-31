// src/app/admin/moderation/page.tsx
'use client'

import { useState, useCallback, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertTriangle,
  CheckCircle,
  XCircle,
  Eye,
  Flag,
  MessageSquare,
  FileText,
  User,
  Clock,
  TrendingUp,
  Shield,
  AlertCircle,
  Info,
  ChevronRight,
  RefreshCw,
  Filter,
  Search,
  MoreVertical,
  Trash2,
  Ban,
  UserX,
  CheckCheck,
  Sparkles,
  Brain,
  Zap
} from 'lucide-react'
import { api } from '@/lib/api'
import { ContentPreviewDialog } from '@/components/admin/content-preview-dialog'
import { formatDate, formatDistanceToNow } from '@/lib/utils'
import { cn } from '@/lib/utils'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Progress } from '@/components/ui/progress'
import { useDebounce } from '@/hooks/use-debounce'
import { toast } from '@/components/ui/use-toast'

type ContentType = 'all' | 'posts' | 'comments' | 'users' | 'messages'
type ModerationStatus = 'pending' | 'approved' | 'rejected' | 'escalated'
type ReportReason = 'spam' | 'inappropriate' | 'harassment' | 'misinformation' | 'copyright' | 'other'

interface FilterState {
  search: string
  type: ContentType
  status: ModerationStatus
  reason: ReportReason | 'all'
  aiScore: { min?: number; max?: number }
  dateRange: { start?: Date; end?: Date }
  priority: 'all' | 'high' | 'medium' | 'low'
}

interface ModerationAction {
  action: 'approve' | 'reject' | 'escalate' | 'delete' | 'ban'
  contentId: string
  contentType: string
  reason?: string
  banDuration?: number
}

export default function ModerationPage() {
  const [filterState, setFilterState] = useState<FilterState>({
    search: '',
    type: 'all',
    status: 'pending',
    reason: 'all',
    aiScore: {},
    dateRange: {},
    priority: 'all',
  })
  
  const [selectedContent, setSelectedContent] = useState<any>(null)
  const [bulkSelection, setBulkSelection] = useState<Set<string>>(new Set())
  const [showBulkActions, setShowBulkActions] = useState(false)
  const [moderationAction, setModerationAction] = useState<ModerationAction | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const debouncedSearch = useDebounce(filterState.search, 300)

  const { data: reports, isLoading, refetch } = api.admin.getReports.useQuery({
    search: debouncedSearch,
    type: filterState.type === 'all' ? undefined : filterState.type,
    status: filterState.status,
    reason: filterState.reason === 'all' ? undefined : filterState.reason,
    aiScoreMin: filterState.aiScore.min,
    aiScoreMax: filterState.aiScore.max,
    dateStart: filterState.dateRange.start,
    dateEnd: filterState.dateRange.end,
    priority: filterState.priority === 'all' ? undefined : filterState.priority,
  })

  const { data: stats } = api.admin.getModerationStats.useQuery()
  const { data: aiInsights } = api.admin.getAIModerationInsights.useQuery()

  const moderateContent = api.admin.moderateContent.useMutation({
    onSuccess: () => {
      toast({ title: 'Content moderated successfully' })
      refetch()
      setBulkSelection(new Set())
    },
  })

  const bulkModerate = api.admin.bulkModerate.useMutation({
    onSuccess: () => {
      toast({ title: 'Bulk moderation completed' })
      refetch()
      setBulkSelection(new Set())
      setShowBulkActions(false)
    },
  })

  const escalateContent = api.admin.escalateContent.useMutation({
    onSuccess: () => {
      toast({ title: 'Content escalated for review' })
      refetch()
    },
  })

  const trainAI = api.admin.trainAIModeration.useMutation({
    onSuccess: () => {
      toast({ title: 'AI training data submitted' })
    },
  })

  const handleModeration = useCallback(async (action: ModerationAction) => {
    setIsProcessing(true)
    
    try {
      switch (action.action) {
        case 'approve':
        case 'reject':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: action.action === 'approve' ? 'approved' : 'rejected',
            reason: action.reason,
          })
          
          // Train AI with this decision
          await trainAI.mutateAsync({
            contentId: action.contentId,
            decision: action.action,
            reason: action.reason,
          })
          break
          
        case 'escalate':
          await escalateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            note: action.reason,
          })
          break
          
        case 'delete':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: 'deleted',
            reason: action.reason,
          })
          break
          
        case 'ban':
          await moderateContent.mutateAsync({
            contentId: action.contentId,
            type: action.contentType,
            decision: 'banned',
            reason: action.reason,
            banDuration: action.banDuration,
          })
          break
      }
      
      setModerationAction(null)
    } finally {
      setIsProcessing(false)
    }
  }, [moderateContent, escalateContent, trainAI])

  const handleBulkAction = useCallback(async (action: string) => {
    const contentIds = Array.from(bulkSelection)
    
    await bulkModerate.mutateAsync({
      contentIds,
      action,
      reason: 'Bulk moderation action',
    })
  }, [bulkSelection, bulkModerate])

  const getReasonBadge = (reason: string) => {
    const config: Record<string, { color: string; icon: React.ElementType }> = {
      spam: { color: 'bg-yellow-500', icon: AlertTriangle },
      inappropriate: { color: 'bg-red-500', icon: XCircle },
      harassment: { color: 'bg-orange-500', icon: UserX },
      misinformation: { color: 'bg-purple-500', icon: AlertCircle },
      copyright: { color: 'bg-blue-500', icon: Shield },
      other: { color: 'bg-gray-500', icon: Flag },
    }
    
    const { color, icon: Icon } = config[reason] || config.other
    
    return (
      <Badge variant="secondary" className={cn("gap-1", color, "text-white")}>
        <Icon className="w-3 h-3" />
        {reason}
      </Badge>
    )
  }

  const getPriorityColor = (score: number) => {
    if (score >= 0.8) return 'text-red-500'
    if (score >= 0.6) return 'text-orange-500'
    if (score >= 0.4) return 'text-yellow-500'
    return 'text-green-500'
  }

  const getContentIcon = (type: string) => {
    switch (type) {
      case 'post': return FileText
      case 'comment': return MessageSquare
      case 'user': return User
      case 'message': return MessageSquare
      default: return FileText
    }
  }

  const renderModerationQueue = () => {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="w-6 h-6 animate-spin" />
        </div>
      )
    }

    if (!reports?.items.length) {
      return (
        <Alert className="border-green-500 bg-green-500/10">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <AlertTitle>All Clear!</AlertTitle>
          <AlertDescription>
            No content pending moderation. The community is in good shape!
          </AlertDescription>
        </Alert>
      )
    }

    return (
      <div className="space-y-4">
        {reports.items.map((report: any) => {
          const ContentIcon = getContentIcon(report.contentType)
          const isSelected = bulkSelection.has(report.id)
          
          return (
            <Card 
              key={report.id} 
              className={cn(
                "border-l-4 transition-all",
                report.priority === 'high' && "border-l-red-500",
                report.priority === 'medium' && "border-l-orange-500",
                report.priority === 'low' && "border-l-yellow-500",
                isSelected && "ring-2 ring-primary"
              )}
            >
              <CardContent className="p-4">
                <div className="flex items-start gap-4">
                  {/* Selection checkbox */}
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={(checked) => {
                      const newSelection = new Set(bulkSelection)
                      if (checked) {
                        newSelection.add(report.id)
                      } else {
                        newSelection.delete(report.id)
                      }
                      setBulkSelection(newSelection)
                      setShowBulkActions(newSelection.size > 0)
                    }}
                  />

                  {/* Content preview */}
                  <div className="flex-1 space-y-3">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <ContentIcon className="w-4 h-4 text-muted-foreground" />
                          <span className="text-sm font-medium capitalize">{report.contentType}</span>
                          {getReasonBadge(report.reason)}
                          {report.reportCount > 1 && (
                            <Badge variant="outline">
                              {report.reportCount} reports
                            </Badge>
                          )}
                          <span className="text-sm text-muted-foreground">
                            {formatDistanceToNow(report.createdAt)} ago
                          </span>
                        </div>
                        
                        {/* Content title/preview */}
                        <h4 className="font-semibold">
                          {report.content.title || `${report.contentType} by ${report.content.author?.username}`}
                        </h4>
                        
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {report.content.content || report.content.text || report.content.message}
                        </p>
                      </div>

                      {/* AI Score */}
                      {report.aiScore !== undefined && (
                        <div className="text-center">
                          <div className={cn("text-2xl font-bold", getPriorityColor(report.aiScore))}>
                            {Math.round(report.aiScore * 100)}%
                          </div>
                          <p className="text-xs text-muted-foreground">AI Score</p>
                        </div>
                      )}
                    </div>

                    {/* Report details */}
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <Avatar className="w-6 h-6">
                          <AvatarImage src={report.content.author?.image} />
                          <AvatarFallback>{report.content.author?.username?.[0]}</AvatarFallback>
                        </Avatar>
                        <span>{report.content.author?.username}</span>
                        {report.content.author?.verified && (
                          <CheckCircle className="w-3 h-3 text-blue-500" />
                        )}
                      </div>
                      
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <Eye className="w-3 h-3" />
                        {report.content.views || 0} views
                      </div>
                      
                      <div className="flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="w-3 h-3" />
                        {report.content._count?.comments || 0} comments
                      </div>
                    </div>

                    {/* AI Insights */}
                    {report.aiInsights && (
                      <Alert className="bg-muted/50 border-0">
                        <Brain className="w-4 h-4" />
                        <AlertDescription className="text-sm">
                          <strong>AI Analysis:</strong> {report.aiInsights.summary}
                          {report.aiInsights.suggestedAction && (
                            <span className="block mt-1">
                              <strong>Suggested:</strong> {report.aiInsights.suggestedAction}
                            </span>
                          )}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* Reporter notes */}
                    {report.notes && report.notes.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-sm font-medium">Reporter Notes:</p>
                        {report.notes.map((note: any, index: number) => (
                          <blockquote key={index} className="border-l-2 pl-3 text-sm text-muted-foreground">
                            "{note.text}" - {note.reporter}
                          </blockquote>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center justify-between">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setSelectedContent(report.content)}
                      >
                        <Eye className="w-4 h-4 mr-2" />
                        View Full Content
                      </Button>

                      <div className="flex items-center gap-2">
                        <Button
                          variant="default"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'approve',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <CheckCircle className="w-4 h-4 mr-1" />
                          Approve
                        </Button>
                        
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'reject',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <XCircle className="w-4 h-4 mr-1" />
                          Reject
                        </Button>
                        
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setModerationAction({
                            action: 'escalate',
                            contentId: report.contentId,
                            contentType: report.contentType,
                          })}
                        >
                          <TrendingUp className="w-4 h-4 mr-1" />
                          Escalate
                        </Button>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem 
                              onClick={() => setModerationAction({
                                action: 'delete',
                                contentId: report.contentId,
                                contentType: report.contentType,
                              })}
                              className="text-destructive"
                            >
                              <Trash2 className="w-4 h-4 mr-2" />
                              Delete Content
                            </DropdownMenuItem>
                            
                            {report.contentType !== 'user' && (
                              <DropdownMenuItem 
                                onClick={() => setModerationAction({
                                  action: 'ban',
                                  contentId: report.content.author?.id,
                                  contentType: 'user',
                                })}
                                className="text-destructive"
                              >
                                <Ban className="w-4 h-4 mr-2" />
                                Ban Author
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold">Content Moderation</h1>
          <p className="text-muted-foreground">
            Review reported content and maintain community standards
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => refetch()}
          >
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          {aiInsights?.autoModerationEnabled && (
            <Badge variant="secondary" className="gap-1">
              <Zap className="w-3 h-3" />
              AI Auto-Moderation Active
            </Badge>
          )}
        </div>
      </div>

      {/* Stats Overview */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Pending Review</p>
                  <p className="text-2xl font-bold">{stats.pending}</p>
                </div>
                <Clock className="w-8 h-8 text-orange-500" />
              </div>
              {stats.oldestPending && (
                <p className="text-xs text-muted-foreground mt-2">
                  Oldest: {formatDistanceToNow(stats.oldestPending)} ago
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Approved Today</p>
                  <p className="text-2xl font-bold text-green-500">{stats.approvedToday}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-500" />
              </div>
              <Progress 
                value={(stats.approvedToday / (stats.approvedToday + stats.rejectedToday)) * 100} 
                className="mt-2 h-1"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Rejected Today</p>
                  <p className="text-2xl font-bold text-red-500">{stats.rejectedToday}</p>
                </div>
                <XCircle className="w-8 h-8 text-red-500" />
              </div>
              <Progress 
                value={(stats.rejectedToday / (stats.approvedToday + stats.rejectedToday)) * 100} 
                className="mt-2 h-1"
                color="red"
              />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Escalated</p>
                  <p className="text-2xl font-bold text-orange-500">{stats.escalated}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-orange-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Requires admin review
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">AI Accuracy</p>
                  <p className="text-2xl font-bold">{Math.round(stats.aiAccuracy * 100)}%</p>
                </div>
                <Brain className="w-8 h-8 text-purple-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Last 7 days
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* AI Insights Alert */}
      {aiInsights?.suggestions && aiInsights.suggestions.length > 0 && (
        <Alert className="border-purple-500 bg-purple-500/10">
          <Brain className="w-4 h-4" />
          <AlertTitle>AI Insights</AlertTitle>
          <AlertDescription>
            {aiInsights.suggestions[0]}
          </AlertDescription>
        </Alert>
      )}

      {/* Moderation Queue */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Moderation Queue</CardTitle>
              <CardDescription>
                Review and take action on reported content
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {/* Filters */}
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                  <Input
                    placeholder="Search content..."
                    value={filterState.search}
                    onChange={(e) => setFilterState(prev => ({ ...prev, search: e.target.value }))}
                    className="pl-10 w-[200px]"
                  />
                </div>

                <Select 
                  value={filterState.type} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, type: value as ContentType }))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="posts">Posts</SelectItem>
                    <SelectItem value="comments">Comments</SelectItem>
                    <SelectItem value="users">Users</SelectItem>
                    <SelectItem value="messages">Messages</SelectItem>
                  </SelectContent>
                </Select>

                <Select 
                  value={filterState.reason} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, reason: value as any }))}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Reasons</SelectItem>
                    <SelectItem value="spam">Spam</SelectItem>
                    <SelectItem value="inappropriate">Inappropriate</SelectItem>
                    <SelectItem value="harassment">Harassment</SelectItem>
                    <SelectItem value="misinformation">Misinformation</SelectItem>
                    <SelectItem value="copyright">Copyright</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>

                <Select 
                  value={filterState.priority} 
                  onValueChange={(value) => setFilterState(prev => ({ ...prev, priority: value as any }))}
                >
                  <SelectTrigger className="w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Priority</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Bulk actions */}
              {showBulkActions && (
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-sm text-muted-foreground">
                    {bulkSelection.size} selected
                  </span>
                  <Button
                    variant="default"
                    size="sm"
                    onClick={() => handleBulkAction('approve')}
                  >
                    Approve All
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => handleBulkAction('reject')}
                  >
                    Reject All
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setBulkSelection(new Set())
                      setShowBulkActions(false)
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Tabs value={filterState.status} onValueChange={(value) => setFilterState(prev => ({ ...prev, status: value as ModerationStatus }))}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending" className="gap-2">
                <Clock className="w-4 h-4" />
                Pending
                {stats?.pending && stats.pending > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.pending}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" className="gap-2">
                <CheckCircle className="w-4 h-4" />
                Approved
              </TabsTrigger>
              <TabsTrigger value="rejected" className="gap-2">
                <XCircle className="w-4 h-4" />
                Rejected
              </TabsTrigger>
              <TabsTrigger value="escalated" className="gap-2">
                <TrendingUp className="w-4 h-4" />
                Escalated
                {stats?.escalated && stats.escalated > 0 && (
                  <Badge variant="secondary" className="ml-1">
                    {stats.escalated}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value={filterState.status} className="mt-6">
              {renderModerationQueue()}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Content Preview Dialog */}
      {selectedContent && (
        <ContentPreviewDialog
          content={selectedContent}
          onClose={() => setSelectedContent(null)}
          onModerate={(action) => {
            setModerationAction({
              action: action as any,
              contentId: selectedContent.id,
              contentType: selectedContent.type || 'post',
            })
            setSelectedContent(null)
          }}
        />
      )}

      {/* Moderation Action Dialog */}
      <Dialog open={!!moderationAction} onOpenChange={() => setModerationAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {moderationAction?.action === 'approve' && 'Approve Content'}
              {moderationAction?.action === 'reject' && 'Reject Content'}
              {moderationAction?.action === 'escalate' && 'Escalate Content'}
              {moderationAction?.action === 'delete' && 'Delete Content'}
              {moderationAction?.action === 'ban' && 'Ban User'}
            </DialogTitle>
            <DialogDescription>
              {moderationAction?.action === 'approve' && 'This content will be visible to all users.'}
              {moderationAction?.action === 'reject' && 'This content will be hidden from users.'}
              {moderationAction?.action === 'escalate' && 'This content will be sent for admin review.'}
              {moderationAction?.action === 'delete' && 'This content will be permanently deleted.'}
              {moderationAction?.action === 'ban' && 'This user will be banned from the platform.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Reason / Notes</Label>
              <Textarea
                placeholder="Provide a reason for this action..."
                value={moderationAction?.reason || ''}
                onChange={(e) => setModerationAction(prev => prev ? { ...prev, reason: e.target.value } : null)}
              />
            </div>

            {moderationAction?.action === 'ban' && (
              <div className="space-y-2">
                <Label>Ban Duration</Label>
                <Select
                  value={moderationAction.banDuration?.toString() || '0'}
                  onValueChange={(value) => setModerationAction(prev => prev ? { ...prev, banDuration: parseInt(value) } : null)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Permanent</SelectItem>
                    <SelectItem value="1">1 Day</SelectItem>
                    <SelectItem value="7">7 Days</SelectItem>
                    <SelectItem value="30">30 Days</SelectItem>
                    <SelectItem value="90">90 Days</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setModerationAction(null)}
              disabled={isProcessing}
            >
              Cancel
            </Button>
            <Button
              variant={moderationAction?.action === 'approve' ? 'default' : 'destructive'}
              onClick={() => moderationAction && handleModeration(moderationAction)}
              disabled={isProcessing}
            >
              {isProcessing && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              Confirm {moderationAction?.action}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// Add missing import
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
