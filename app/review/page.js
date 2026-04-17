'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useSearchParams } from 'next/navigation';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function ReviewPage() {
  const searchParams = useSearchParams();
  const taskId = searchParams.get('task');
  const outputId = searchParams.get('output');

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (taskId && outputId) {
      fetchData();
    } else {
      setLoading(false);
      setErrorMsg(`Missing params: task=${taskId}, output=${outputId}`);
    }
  }, [taskId, outputId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setErrorMsg('');

      console.log('Fetching output ID:', outputId, 'task ID:', taskId);

      // Step 1: Fetch task_output alone first
      const { data: outputData, error: outputError } = await supabase
        .from('task_outputs')
        .select('*')
        .eq('id', outputId)
        .single();

      console.log('Output fetch result:', outputData, outputError);

      if (outputError) {
        setErrorMsg(`Output fetch error: ${JSON.stringify(outputError)}`);
        throw outputError;
      }

      if (!outputData) {
        setErrorMsg(`No output found with id=${outputId}`);
        setLoading(false);
        return;
      }

      // Step 2: Fetch task separately
      const { data: taskData, error: taskError } = await supabase
        .from('tasks')
        .select('*')
        .eq('id', taskId)
        .single();

      console.log('Task fetch result:', taskData, taskError);

      if (taskError) {
        setErrorMsg(`Task fetch error: ${JSON.stringify(taskError)}`);
        throw taskError;
      }

      // Step 3: Fetch project separately
      let projectData = null;
      if (taskData?.project_id) {
        const { data: proj, error: projError } = await supabase
          .from('projects')
          .select('*')
          .eq('id', taskData.project_id)
          .single();

        console.log('Project fetch result:', proj, projError);

        if (!projError) {
          projectData = proj;
        }
      }

      // Combine the data
      const combined = {
        ...outputData,
        // Normalize field names - check what columns actually exist
        file_urls: outputData.file_urls || 
                   (outputData.output_content ? parseOutputContent(outputData.output_content) : []),
        notes: outputData.notes || outputData.output_notes || null,
        external_links: outputData.external_links || [],
        uploaded_by: outputData.uploaded_by || outputData.submitted_by || taskData?.assigned_to || 'Unknown',
        submitted_at: outputData.submitted_at || outputData.created_at,
        approval_status: outputData.approval_status || 'pending',
        tasks: {
          ...taskData,
          task_name: taskData?.task_title || taskData?.title || 'Unnamed Task',
          task_description: taskData?.task_context || taskData?.description || '',
          assigned_to: taskData?.assigned_to || '',
          projects: {
            ...projectData,
            project_name: projectData?.project_name || projectData?.name || 'Unknown Project',
            manager_phone: projectData?.manager_phone || ''
          }
        }
      };

      console.log('Combined data:', combined);
      setData(combined);

    } catch (error) {
      console.error('Error fetching data:', error);
      setErrorMsg(`Error: ${error.message || JSON.stringify(error)}`);
    } finally {
      setLoading(false);
    }
  };

  // Parse output_content if it's a JSON array of file objects
  const parseOutputContent = (outputContent) => {
    try {
      if (typeof outputContent === 'string') {
        const parsed = JSON.parse(outputContent);
        if (Array.isArray(parsed)) {
          // Extract URLs from file objects
          return parsed.map(f => f.url || f.path || f).filter(Boolean);
        }
      }
      if (Array.isArray(outputContent)) {
        return outputContent.map(f => f.url || f.path || f).filter(Boolean);
      }
    } catch (e) {
      console.error('Failed to parse output_content:', e);
    }
    return [];
  };

  const handleApprove = async () => {
    if (!confirm('Are you sure you want to approve this submission?')) return;

    try {
      setSubmitting(true);

      const { error: outputError } = await supabase
        .from('task_outputs')
        .update({
          approval_status: 'approved',
          reviewed_at: new Date().toISOString(),
          reviewed_by: data.tasks?.projects?.manager_phone || 'manager'
        })
        .eq('id', outputId);

      if (outputError) throw outputError;

      const { error: taskError } = await supabase
        .from('tasks')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', taskId);

      if (taskError) throw taskError;

      // Webhooks - fire and forget
      fetch('https://my-n8n-79ua.onrender.com/webhook/auto-handover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id: taskId })
      }).catch(e => console.error('Webhook error:', e));

      fetch('https://my-n8n-79ua.onrender.com/webhook/notify-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_phone: data.tasks.assigned_to,
          task_name: data.tasks.task_name,
          project_name: data.tasks.projects.project_name
        })
      }).catch(e => console.error('Notification error:', e));

      alert('✅ Submission approved! Task marked as complete.');
      window.location.reload();
    } catch (error) {
      console.error('Approval error:', error);
      alert(`Failed to approve: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) {
      alert('Please provide a reason for rejection');
      return;
    }

    try {
      setSubmitting(true);

      const { error: outputError } = await supabase
        .from('task_outputs')
        .update({
          approval_status: 'rejected',
          rejection_reason: rejectionReason,
          reviewed_at: new Date().toISOString(),
          reviewed_by: data.tasks?.projects?.manager_phone || 'manager'
        })
        .eq('id', outputId);

      if (outputError) throw outputError;

      const { error: taskError } = await supabase
        .from('tasks')
        .update({ status: 'in_progress' })
        .eq('id', taskId);

      if (taskError) throw taskError;

      fetch('https://my-n8n-79ua.onrender.com/webhook/notify-rejection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_phone: data.tasks.assigned_to,
          task_name: data.tasks.task_name,
          project_name: data.tasks.projects.project_name,
          reason: rejectionReason
        })
      }).catch(e => console.error('Notification error:', e));

      alert('❌ Submission rejected. Assignee has been notified.');
      setShowRejectModal(false);
      window.location.reload();
    } catch (error) {
      console.error('Rejection error:', error);
      alert(`Failed to reject: ${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const getFileNameFromUrl = (url) => {
    try {
      if (typeof url === 'object') return url.name || 'Download File';
      const parts = url.split('/');
      const filename = parts[parts.length - 1];
      return decodeURIComponent(filename.split('_').slice(1).join('_') || filename);
    } catch {
      return 'Download File';
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading submission...</p>
          <p className="mt-2 text-sm text-gray-400">task={taskId}, output={outputId}</p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center max-w-lg">
          <h2 className="text-2xl font-bold text-gray-800">Submission not found</h2>
          <p className="mt-2 text-gray-600">
            This submission may have been deleted or the link is invalid.
          </p>
          {errorMsg && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg text-left">
              <p className="text-sm text-red-700 font-mono break-all">{errorMsg}</p>
            </div>
          )}
          <p className="mt-4 text-sm text-gray-500">
            task_id={taskId} | output_id={outputId}
          </p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const isAlreadyReviewed =
    data.approval_status !== 'pending' && data.approval_status !== 'submitted';

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      <div className="max-w-4xl mx-auto">

        {/* Header Card */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-start justify-between">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                {data.tasks.task_name}
              </h1>
              <p className="text-lg text-gray-600">
                📁 Project:{' '}
                <span className="font-semibold">{data.tasks.projects.project_name}</span>
              </p>
              <p className="text-sm text-gray-500 mt-1">
                👤 Submitted by:{' '}
                <span className="font-medium">{data.uploaded_by}</span>
              </p>
              <p className="text-sm text-gray-500">
                ⏰ Submitted on:{' '}
                <span className="font-medium">
                  {new Date(data.submitted_at || data.created_at).toLocaleString('en-IN', {
                    dateStyle: 'medium',
                    timeStyle: 'short'
                  })}
                </span>
              </p>
            </div>

            <div
              className={`px-4 py-2 rounded-full text-sm font-semibold ${
                data.approval_status === 'approved'
                  ? 'bg-green-100 text-green-800'
                  : data.approval_status === 'rejected'
                  ? 'bg-red-100 text-red-800'
                  : 'bg-yellow-100 text-yellow-800'
              }`}
            >
              {data.approval_status === 'approved'
                ? '✅ Approved'
                : data.approval_status === 'rejected'
                ? '❌ Rejected'
                : '⏳ Pending Review'}
            </div>
          </div>
        </div>

        {/* Task Description */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">
            📋 Task Context & Instructions
          </h2>
          <pre className="whitespace-pre-wrap bg-gray-50 p-4 rounded-lg text-sm text-gray-700 font-sans">
            {data.tasks.task_description || 'No description provided.'}
          </pre>
          {data.tasks.deadline && (
            <p className="mt-4 text-sm text-gray-600">
              ⏰ <strong>Deadline:</strong>{' '}
              {new Date(data.tasks.deadline).toLocaleString('en-IN', {
                dateStyle: 'long'
              })}
            </p>
          )}
        </div>

        {/* Files */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">📎 Submitted Files</h2>
          {data.file_urls && data.file_urls.length > 0 ? (
            <div className="space-y-3">
              {data.file_urls.map((url, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition"
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">📄</span>
                    <span className="text-gray-700 font-medium text-sm break-all">
                      {getFileNameFromUrl(url)}
                    </span>
                  </div>
                  <a
                    href={typeof url === 'object' ? url.url : url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="ml-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm font-medium whitespace-nowrap"
                  >
                    Download
                  </a>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 italic">No files uploaded</p>
          )}
        </div>

        {/* Notes */}
        {data.notes && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              📝 Notes from Assignee
            </h2>
            <div className="bg-blue-50 border-l-4 border-blue-500 p-4 rounded">
              <p className="text-gray-700 whitespace-pre-wrap">{data.notes}</p>
            </div>
          </div>
        )}

        {/* External Links */}
        {data.external_links && data.external_links.length > 0 && (
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">🔗 External Links</h2>
            <div className="space-y-2">
              {data.external_links.map((link, index) => (
                <a
                  key={index}
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 bg-gray-50 rounded-lg border border-gray-200 hover:bg-gray-100 transition text-blue-600 hover:text-blue-800 break-all"
                >
                  {link}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Rejection Reason Display */}
        {data.approval_status === 'rejected' && data.rejection_reason && (
          <div className="bg-red-50 border-l-4 border-red-500 p-6 rounded-lg mb-6">
            <h2 className="text-xl font-bold text-red-900 mb-2">❌ Rejection Reason</h2>
            <p className="text-red-800">{data.rejection_reason}</p>
          </div>
        )}

        {/* Action Buttons */}
        {!isAlreadyReviewed && (
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Review Actions</h2>
            <div className="flex space-x-4">
              <button
                onClick={handleApprove}
                disabled={submitting}
                className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-lg transition text-lg"
              >
                {submitting ? 'Processing...' : '✅ Approve Submission'}
              </button>
              <button
                onClick={() => setShowRejectModal(true)}
                disabled={submitting}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-bold py-4 px-6 rounded-lg transition text-lg"
              >
                ❌ Request Changes
              </button>
            </div>
          </div>
        )}

        {/* Already Reviewed Banner */}
        {isAlreadyReviewed && (
          <div
            className={`p-6 rounded-lg ${
              data.approval_status === 'approved'
                ? 'bg-green-50 border border-green-200'
                : 'bg-red-50 border border-red-200'
            }`}
          >
            <p className="text-lg font-semibold text-gray-800">
              {data.approval_status === 'approved'
                ? '✅ This submission has already been approved.'
                : '❌ This submission has been rejected.'}
            </p>
            {data.reviewed_at && (
              <p className="text-sm text-gray-600 mt-1">
                Reviewed on:{' '}
                {new Date(data.reviewed_at).toLocaleString('en-IN', {
                  dateStyle: 'medium',
                  timeStyle: 'short'
                })}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Request Changes</h3>
            <p className="text-gray-600 mb-4">
              Please provide a reason for requesting changes:
            </p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="E.g., Missing documentation, incorrect format, incomplete deliverables..."
              className="w-full border border-gray-300 rounded-lg p-3 text-gray-700 focus:ring-2 focus:ring-red-500 focus:border-transparent resize-none"
              rows="4"
            />
            <div className="flex space-x-3 mt-4">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectionReason('');
                }}
                className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-2 px-4 rounded-lg transition"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={submitting || !rejectionReason.trim()}
                className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-semibold py-2 px-4 rounded-lg transition"
              >
                {submitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}