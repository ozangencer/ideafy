import { Folder } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "./color-picker";
import { useFolderPicker } from "./use-folder-picker";

interface BasicInfoFieldsProps {
  name: string;
  onNameChange: (value: string) => void;
  folderPath: string;
  onFolderPathChange: (value: string) => void;
  idPrefix: string;
  onIdPrefixChange: (value: string) => void;
  color: string;
  onColorChange: (color: string) => void;
  /** Prefix for HTML input ids so Add and Edit modals don't collide when both mount. */
  inputIdPrefix: string;
  autoFocusName?: boolean;
}

/**
 * Shared Project form fields: name, folder path (with picker), id prefix,
 * and color picker. Rendered as a fragment so callers control the outer
 * wrapper layout and keep markup like the "Task IDs:" hint at the call site.
 */
export function BasicInfoFields(props: BasicInfoFieldsProps) {
  const {
    name,
    onNameChange,
    folderPath,
    onFolderPathChange,
    idPrefix,
    onIdPrefixChange,
    color,
    onColorChange,
    inputIdPrefix,
    autoFocusName,
  } = props;

  const { isPicking, pickFolder } = useFolderPicker();

  const handleFolderPick = async () => {
    const path = await pickFolder();
    if (path) onFolderPathChange(path);
  };

  return (
    <>
      <div className="grid gap-2">
        <label htmlFor={`${inputIdPrefix}name`} className="text-sm font-medium">
          Project Name
        </label>
        <Input
          id={`${inputIdPrefix}name`}
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="My Project"
          autoFocus={autoFocusName}
        />
      </div>

      <div className="grid gap-2">
        <label htmlFor={`${inputIdPrefix}folderPath`} className="text-sm font-medium">
          Folder Path
        </label>
        <div className="flex gap-2">
          <Input
            id={`${inputIdPrefix}folderPath`}
            value={folderPath}
            onChange={(e) => onFolderPathChange(e.target.value)}
            placeholder="/Users/username/projects/my-project"
            className="flex-1"
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={handleFolderPick}
            disabled={isPicking}
            title="Browse folders"
          >
            <Folder className="h-4 w-4" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Full path to the project directory
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="grid gap-2">
          <label htmlFor={`${inputIdPrefix}idPrefix`} className="text-sm font-medium">
            ID Prefix
          </label>
          <Input
            id={`${inputIdPrefix}idPrefix`}
            value={idPrefix}
            onChange={(e) => onIdPrefixChange(e.target.value.toUpperCase().slice(0, 5))}
            placeholder="PRJ"
            maxLength={5}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium">Color</label>
          <ColorPicker color={color} onChange={onColorChange} />
        </div>
      </div>
    </>
  );
}
