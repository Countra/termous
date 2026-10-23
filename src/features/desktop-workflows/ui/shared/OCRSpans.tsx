import { Table, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import type { OCRSpan } from '#entities/desktop-workflow'

export function OCRSpans({ spans }: { spans: OCRSpan[] }) {
  const { t } = useTranslation()
  return <Table size="small" rowKey="id" dataSource={spans} pagination={false} columns={[
    {title:'#',dataIndex:'id',width:45},
    {title:t('desktopWorkflow.ocr.text'),key:'text',render:(_,s:OCRSpan) => <><span style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{s.text}</span>{s.matched && <Tag>{t('desktopWorkflow.ocr.matched')}</Tag>}</>},
    {title:t('desktopWorkflow.ocr.confidence'),dataIndex:'confidence',width:85,render:(value:number) => value.toFixed(3)},
    {title:t('desktopWorkflow.ocr.coordinates'),key:'coordinates',render:(_,s:OCRSpan) => s.bbox_xyxy.join(', ')},
  ]} />
}
