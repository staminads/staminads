import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useState, useMemo } from 'react'
import { Button, Empty, Segmented, Input, Space } from 'antd'
import { PlusOutlined, ExperimentOutlined, SearchOutlined } from '@ant-design/icons'
import { filtersQueryOptions, filterTagsQueryOptions, workspaceQueryOptions } from '../../../../lib/queries'
import { FilterTable, FilterFormModal, TestFilterModal, BackfillStatus } from '../../../../components/filters'
import type { FilterWithStaleness } from '../../../../types/filters'

interface FiltersSearch {
  tag?: string
}

export const Route = createFileRoute('/_authenticated/workspaces/$workspaceId/filters')({
  validateSearch: (search: Record<string, unknown>): FiltersSearch => ({
    tag: (search.tag as string) || undefined,
  }),
  loader: async ({ context, params }) => {
    await Promise.all([
      context.queryClient.ensureQueryData(filtersQueryOptions(params.workspaceId)),
      context.queryClient.ensureQueryData(filterTagsQueryOptions(params.workspaceId)),
      context.queryClient.ensureQueryData(workspaceQueryOptions(params.workspaceId)),
      // backfillSummary is prefetched in parent layout ($workspaceId.tsx)
    ])
  },
  component: FiltersPage,
})

function FiltersPage() {
  const { workspaceId } = Route.useParams()
  const { tag: urlTag } = Route.useSearch()
  const navigate = useNavigate()
  const { data: filters } = useSuspenseQuery(filtersQueryOptions(workspaceId))
  const { data: tags } = useSuspenseQuery(filterTagsQueryOptions(workspaceId))
  const { data: workspace } = useSuspenseQuery(workspaceQueryOptions(workspaceId))

  // Use URL tag if valid, otherwise default to 'all'
  const selectedTag = urlTag && tags.includes(urlTag) ? urlTag : 'all'

  const [modalOpen, setModalOpen] = useState(false)
  const [editingFilter, setEditingFilter] = useState<FilterWithStaleness | undefined>()
  const [searchText, setSearchText] = useState('')
  const [testModalOpen, setTestModalOpen] = useState(false)

  const setSelectedTag = (tag: string) => {
    navigate({
      to: '.',
      search: { tag: tag === 'all' ? undefined : tag },
      replace: true,
    })
  }

  const filteredFilters = useMemo(() => {
    if (selectedTag === 'all') return filters
    return filters.filter((f) => f.tags.includes(selectedTag))
  }, [filters, selectedTag])

  const handleCreate = () => {
    setEditingFilter(undefined)
    setModalOpen(true)
  }

  const handleEdit = (filter: FilterWithStaleness) => {
    setEditingFilter(filter)
    setModalOpen(true)
  }

  const handleCloseModal = () => {
    setModalOpen(false)
    setEditingFilter(undefined)
  }

  const segmentedOptions = [
    { value: 'all', label: 'All' },
    ...tags.map((tag) => ({ value: tag, label: tag })),
  ]

  return (
    <div className="p-6">
      <div className="mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-gray-900">Filters</h1>
          <Space>
            <Button type="primary" ghost icon={<ExperimentOutlined />} onClick={() => setTestModalOpen(true)}>
              Test
            </Button>
            <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
              <span className="hidden md:inline">Create Filter</span>
              <span className="md:hidden">Create</span>
            </Button>
          </Space>
        </div>
        <p className="text-gray-500 mt-3 md:mt-1">
          Define filters to map channels, set custom dimensions, and modify traffic source fields
        </p>
      </div>

      <BackfillStatus workspaceId={workspaceId} />

      {filters.length > 0 && (
        <div className="mb-4 flex flex-col md:flex-row md:items-center gap-4">
          {tags.length > 0 && (
            <Segmented
              value={selectedTag}
              onChange={(value) => setSelectedTag(String(value))}
              options={segmentedOptions}
            />
          )}
          <div className="w-full md:w-[300px] md:ml-auto">
            <Input
              placeholder="Search..."
              allowClear
              prefix={<SearchOutlined className="text-gray-400" />}
              onChange={(e) => setSearchText(e.target.value)}
            />
          </div>
        </div>
      )}

      {filteredFilters.length > 0 ? (
        <FilterTable
          workspaceId={workspaceId}
          filters={filteredFilters}
          onEdit={handleEdit}
          searchText={searchText}
          customDimensionLabels={workspace.settings.custom_dimensions}
        />
      ) : filters.length > 0 ? (
        <Empty
          description="No filters match the selected tags"
          className="py-12"
        />
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            <span className="text-gray-500">
              No filters yet. Create your first filter to start organizing your traffic data.
            </span>
          }
          className="py-12"
        >
          <Button type="primary" icon={<PlusOutlined />} onClick={handleCreate}>
            Create Filter
          </Button>
        </Empty>
      )}

      <FilterFormModal
        workspaceId={workspaceId}
        filter={editingFilter}
        existingTags={tags}
        customDimensionLabels={workspace.settings.custom_dimensions}
        open={modalOpen}
        onClose={handleCloseModal}
      />

      <TestFilterModal
        filters={filters}
        customDimensionLabels={workspace.settings.custom_dimensions}
        open={testModalOpen}
        onClose={() => setTestModalOpen(false)}
      />
    </div>
  )
}
