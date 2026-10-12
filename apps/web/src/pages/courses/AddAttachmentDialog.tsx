import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import media from '../media/Media.module.css';

interface AddAttachmentDialogProps {
  open: boolean;
  onClose: () => void;
  onUpload: () => void;
  onLibrary: () => void;
}

// The two ways a file gets into a topic.
export function AddAttachmentDialog({ open, onClose, onUpload, onLibrary }: AddAttachmentDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title="Add an attachment">
      <p>Upload a new file, or pick one that is already in the library (Videos, Movies, Podcasts or Songs).</p>
      <div className={media.dialogActions}>
        <Button variant="secondary" onClick={onLibrary}>
          From the library
        </Button>
        <Button data-autofocus onClick={onUpload}>
          Upload a file
        </Button>
      </div>
    </Dialog>
  );
}
