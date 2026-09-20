# Linux File Access Commands - Term-by-Term Reference

This is a command-language reference for Linux file ownership, permissions, ACLs, and the equivalent MyRepos controls. Examples assume GNU/Linux; BSD and macOS variants can differ.

## 1. How to read a command

Consider:

~~~bash
find '/var/www/myapp' -xdev -type d -exec chmod 2775 -- '{}' +
~~~

| Position | Argument | Meaning |
|---:|---|---|
| 1 | find | Program |
| 2 | /var/www/myapp | Starting path |
| 3 | -xdev | Do not cross filesystem boundaries |
| 4-5 | -type d | Match directories |
| 6 | -exec | Run a command for matches |
| 7-8 | chmod 2775 | Command and desired mode |
| 9 | -- | End chmod options |
| 10 | {} | Placeholder for matched paths |
| 11 | + | Batch matches into fewer chmod calls |

General terms:

- **Command** - executable program name
- **Option** - changes command behavior, usually starts with a hyphen
- **Operand** - data such as a path
- **Exit status 0** - success
- **Nonzero exit status** - failure or partial failure

### Quotes

Quotes keep a path containing spaces or shell characters as one argument:

~~~bash
chmod 0644 '/var/www/My Site/config file.php'
~~~

Single quotes prevent almost all shell interpretation. MyRepos generates single-quoted paths.

### Double hyphen

Double hyphen ends option parsing:

~~~bash
chmod 0644 -- '-unusual-file-name'
~~~

Without it, a name beginning with a hyphen could be treated as an option.

## 2. Permission vocabulary

Each item has an owning user, owning group, owner/group/other mode bits, optional special bits, and possibly POSIX ACLs.

### Subject classes

| Class | Symbol | Meaning |
|---|---|---|
| Owner | u | User owning the item |
| Group | g | Users matched through the owning group |
| Others | o | Everyone else |
| All | a | Owner, group, and others |

### Permission bits

| Permission | Symbol | Value | File meaning | Directory meaning |
|---|---|---:|---|---|
| Read | r | 4 | Read content | List names |
| Write | w | 2 | Modify content | Create, rename, delete entries |
| Execute | x | 1 | Run it | Enter and traverse it |

Directory execute permission is required to access children. Directory write alone is not sufficient for normal use.

### Octal sums

| Digit | Calculation | Permissions |
|---:|---|---|
| 7 | 4 + 2 + 1 | rwx |
| 6 | 4 + 2 | rw- |
| 5 | 4 + 1 | r-x |
| 4 | 4 | r-- |
| 3 | 2 + 1 | -wx |
| 2 | 2 | -w- |
| 1 | 1 | --x |
| 0 | 0 | --- |

The final three digits mean owner, group, and others:

- 0755 = owner rwx, group r-x, others r-x
- 0644 = owner rw-, group r--, others r--
- 0770 = owner rwx, group rwx, others ---
- 0600 = owner rw-, group ---, others ---

### Special leading digit

| Value | Name | Effect |
|---:|---|---|
| 4 | setuid | Executable runs with file owner's effective UID |
| 2 | setgid | Directory children inherit its group |
| 1 | sticky | Directory entries are protected from deletion by unrelated users |

Examples:

- 2775 = setgid plus 0775
- 1777 = sticky plus 0777, commonly used for /tmp
- 4755 = setuid plus 0755

## 3. ls - inspect symbolic permissions

Syntax:

~~~bash
ls [OPTIONS] [PATH...]
~~~

Useful form:

~~~bash
ls -ld -- '/var/www/myapp'
~~~

| Term | Meaning |
|---|---|
| ls | List entries |
| -l | Long format |
| -d | Show the directory itself, not its contents |
| -- | End options |
| path | Target |

Example:

~~~text
drwxrwsr-x 8 ginipig www-data 4096 Sep 20 12:30 /var/www/myapp
~~~

| Part | Meaning |
|---|---|
| d | Directory; hyphen means regular file |
| rwx | Owner permissions |
| rws | Group permissions; lowercase s means execute plus setgid |
| r-x | Others permissions |
| 8 | Hard-link count |
| ginipig | Owner |
| www-data | Group |
| 4096 | Displayed size |
| date | Modification time |
| final field | Name/path |

Special characters:

- s = setuid/setgid plus execute
- S = setuid/setgid without execute
- t = sticky plus execute
- T = sticky without execute
- + after mode often means an ACL exists
- . can indicate a security context

Useful options: -a includes dotfiles, -n shows numeric IDs, -h formats sizes, and -L dereferences links.

## 4. stat - inspect exact metadata

Syntax:

~~~bash
stat [OPTIONS] PATH...
~~~

Machine-readable example:

~~~bash
stat -c '%F|%a|%A|%U|%G|%u|%g|%d|%i|%Y|%n' -- '/var/www/myapp'
~~~

| Format | Meaning |
|---|---|
| %F | File type |
| %a | Octal mode |
| %A | Symbolic mode |
| %U / %G | Owner/group names |
| %u / %g | Numeric UID/GID |
| %d | Device number |
| %i | Inode |
| %Y | Modification epoch |
| %n | Name |
| -c | Custom output format |

Device plus inode identifies an object more reliably than its name. MyRepos rechecks identity/state before applying a preview.

For links:

~~~bash
stat -- '/path/to/link'
stat -L -- '/path/to/link'
~~~

Without -L, inspect the link. With -L, inspect its target.

## 5. id and groups - inspect identity

~~~bash
id ginipig
~~~

Example:

~~~text
uid=1002(ginipig) gid=1002(ginipig) groups=1002(ginipig),33(www-data)
~~~

| Form | Result |
|---|---|
| id -u USER | UID |
| id -g USER | Primary GID |
| id -gn USER | Primary group name |
| id -G USER | All group IDs |
| id -Gn USER | All group names |
| groups USER | Group names |

Membership matters only when an item grants access to that group or through an ACL.

## 6. chown - change owner and group

Syntax:

~~~bash
chown [OPTIONS] OWNER[:GROUP] PATH...
~~~

Owner and group:

~~~bash
chown ginipig:www-data -- '/var/www/myapp'
~~~

| Term | Meaning |
|---|---|
| chown | Change ownership |
| ginipig | New owner |
| : | Owner/group separator |
| www-data | New group |
| -- | End options |
| path | Target |

Owner only:

~~~bash
chown ginipig -- '/var/www/myapp'
~~~

Group only:

~~~bash
chown :www-data -- '/var/www/myapp'
~~~

Recursive:

~~~bash
chown -R ginipig:www-data -- '/var/www/myapp'
~~~

| Option | Meaning |
|---|---|
| -R | Recursive |
| -h | Change a link itself, not its target |
| -P | Do not traverse links; safest recursive policy |
| -H | Follow a command-line link to a directory |
| -L | Follow all encountered links; potentially dangerous |
| --from=OLD | Change only items currently owned by OLD |
| --reference=FILE | Copy owner/group from FILE |

MyRepos uses chown -h inside a find walk. Changing owner/group does not change mode bits, so chown alone may not create the intended access.

## 7. chgrp - change only the group

Syntax:

~~~bash
chgrp [OPTIONS] GROUP PATH...
~~~

~~~bash
chgrp www-data -- '/var/www/myapp'
chgrp -R www-data -- '/var/www/myapp'
~~~

Options -R, -h, -P, -H, -L, and --reference behave similarly to chown.

These are conceptually equivalent:

~~~bash
chgrp www-data file
chown :www-data file
~~~

## 8. chmod - change mode bits

Syntax:

~~~bash
chmod [OPTIONS] MODE PATH...
~~~

MODE can be octal or symbolic.

### Octal mode

~~~bash
chmod 0644 -- '/var/www/myapp/config.php'
~~~

| Term | Meaning |
|---|---|
| chmod | Change mode |
| 0 | No special bits |
| 6 | Owner: read + write |
| 4 | Group: read |
| 4 | Others: read |
| -- | End options |
| path | Target |

### Symbolic mode grammar

~~~text
[WHO][OPERATOR][PERMISSIONS]
~~~

WHO:

- u - owner
- g - group
- o - others
- a - all
- omitted - affected classes depend on umask

OPERATOR:

- + - add bits
- - - remove bits
- = - set exactly these bits

PERMISSIONS:

- r - read
- w - write
- x - execute
- X - execute only for directories or when an execute bit already exists
- s - setuid/setgid
- t - sticky
- u, g, o - copy bits from another class

Examples:

~~~bash
chmod u+rw file
chmod g-w file
chmod o= file
chmod a+r file
chmod g=u file
chmod -R u+rwX,g+rX,o-rwx directory
~~~

Capital X is useful recursively: it adds traversal to directories without making every ordinary file executable.

### Recursive chmod warning

~~~bash
chmod -R 0755 -- '/var/www/myapp'
~~~

This gives 0755 to directories and files. It therefore marks ordinary files executable.

Prefer:

~~~bash
find '/var/www/myapp' -xdev -type d -exec chmod 0755 -- '{}' +
find '/var/www/myapp' -xdev -type f -exec chmod 0644 -- '{}' +
~~~

Other useful forms:

~~~bash
chmod --reference='/known/good/file' -- '/target/file'
chmod --preserve-root -R 0755 -- '/safe/path'
~~~

- --reference copies mode from another item
- --preserve-root protects against certain recursive operations on slash
- MyRepos adds its own protected-path and confirmation checks

## 9. find - select items and perform precise actions

General structure:

~~~bash
find STARTING_PATH [TRAVERSAL_OPTIONS] [TESTS] [ACTIONS]
~~~

### Starting path

~~~bash
find '/var/www/myapp'
~~~

find visits the starting item and its descendants.

### Traversal controls

| Option | Meaning |
|---|---|
| -xdev | Stay on the starting filesystem |
| -mount | Common synonym for -xdev |
| -maxdepth N | Descend at most N levels |
| -mindepth N | Skip actions/tests above level N |
| -depth | Process children before parents |
| -P | Never follow links; default and safest |
| -H | Follow command-line links |
| -L | Follow links encountered during traversal |

Examples:

~~~bash
find '/var/www/myapp' -maxdepth 1
find '/var/www/myapp' -mindepth 1
find -P '/var/www/myapp' -xdev
~~~

### Type test

~~~bash
-type d
-type f
-type l
~~~

| Letter | Type |
|---|---|
| d | Directory |
| f | Regular file |
| l | Symbolic link |
| b | Block device |
| c | Character device |
| p | Named pipe |
| s | Socket |

### Ownership tests

~~~bash
find '/srv/project' -user ginipig
find '/srv/project' -group www-data
find '/srv/project' -uid 1002
find '/srv/project' -gid 33
find '/srv/project' -nouser
find '/srv/project' -nogroup
~~~

### Permission tests

~~~bash
find '/srv/project' -perm 0644
find '/srv/project' -perm -002
find '/srv/project' -perm /111
~~~

- -perm 0644 - exact bits
- -perm -002 - all listed bits are present; here world-write
- -perm /111 - any listed bit is present; here executable by someone

Audits:

~~~bash
find '/var/www' -xdev -type f -perm /111 -print
find '/var/www' -xdev -perm -0002 -print
find '/srv' -xdev \( -nouser -o -nogroup \) -print
~~~

### Name and path tests

~~~bash
find '/var/www' -name '*.php'
find '/var/www' -iname '*.JPG'
find '/var/www' -path '*/cache/*'
~~~

- -name checks basename case-sensitively
- -iname checks basename case-insensitively
- -path checks the full visited path
- Quote wildcard patterns so the shell does not expand them first

### Actions

| Action | Meaning |
|---|---|
| -print | Print each match |
| -print0 | Null-separated output |
| -exec COMMAND {} \; | Run once per match |
| -exec COMMAND {} + | Batch matches |
| -ok COMMAND {} \; | Ask before each execution |
| -delete | Delete matches; dangerous and order-sensitive |

In -exec, braces are replaced with matched paths:

~~~bash
find '/srv/project' -type f -exec stat -- '{}' +
~~~

The plus batches many paths and is efficient. The escaped semicolon runs once per path:

~~~bash
find '/srv/project' -type f -exec chmod 0644 -- '{}' \;
~~~

Logical operators:

| Operator | Meaning |
|---|---|
| -a | AND; often implicit |
| -o | OR |
| ! | NOT |
| ( ... ) | Grouping; protect parentheses from the shell |

~~~bash
find '/srv/project' -xdev \( -type f -o -type d \) -user ginipig -print
~~~

## 10. Combined policy, token by token

Ownership:

~~~bash
find '/var/www/myapp' -xdev -exec chown -h 'ginipig:www-data' -- '{}' +
~~~

| Term | Purpose |
|---|---|
| find | Walk tree |
| path | Policy root |
| -xdev | Stay on filesystem |
| -exec | Begin action |
| chown | Change ownership |
| -h | Change links themselves |
| ginipig:www-data | Owner and group |
| -- | End chown options |
| {} | Matches |
| + | Batch matches |

Directories:

~~~bash
find '/var/www/myapp' -xdev -type d -exec chmod 2775 -- '{}' +
~~~

- -type d means directories only
- 2 enables setgid group inheritance
- 775 lets owner/group work and others read/traverse

Files:

~~~bash
find '/var/www/myapp' -xdev -type f -exec chmod 0664 -- '{}' +
~~~

- -type f means regular files only
- 0 means no special bits
- 664 lets owner/group read/write and others read
- No execute bit is added

These three commands are one composable access policy.

## 11. getfacl - inspect POSIX ACLs

Syntax:

~~~bash
getfacl [OPTIONS] PATH...
~~~

~~~bash
getfacl -p -- '/var/www/myapp'
~~~

| Term | Meaning |
|---|---|
| getfacl | Read ACLs |
| -p | Keep leading slash in displayed path |
| -- | End options |
| path | Target |

Example:

~~~text
# file: /var/www/myapp
# owner: ginipig
# group: www-data
user::rwx
user:deploy:rwx
group::r-x
group:www-data:rwx
mask::rwx
other::r-x
default:user::rwx
default:user:deploy:rwx
default:group::rwx
default:mask::rwx
default:other::r-x
~~~

ACL grammar:

~~~text
TYPE:NAME:PERMISSIONS
~~~

- user::rwx - owning user's base entry
- user:deploy:rwx - named user
- group::r-x - owning group's base entry
- group:www-data:rwx - named group
- mask::rwx - maximum effective rights for named users/groups
- other::r-x - everyone else
- default:... - inheritance template on a directory

### ACL mask

The mask limits effective permissions for named users, the owning group, and named groups. An entry can request rwx but be effectively r-x when the mask is r-x. The owning user's entry and other entry are not limited by this mask in the same way.

## 12. setfacl - change POSIX ACLs

Syntax:

~~~bash
setfacl [OPTIONS] PATH...
~~~

Add or modify a named user:

~~~bash
setfacl -m u:deploy:rwx -- '/var/www/myapp'
~~~

| Term | Meaning |
|---|---|
| setfacl | Change ACL |
| -m | Modify/add entries |
| u | User entry |
| deploy | Account |
| rwx | Requested access |
| -- | End options |
| path | Target |

Named group:

~~~bash
setfacl -m g:www-data:rwx -- '/var/www/myapp'
~~~

Multiple entries:

~~~bash
setfacl -m u:deploy:rwx,g:auditors:r-x -- '/var/www/myapp'
~~~

Remove one entry:

~~~bash
setfacl -x u:deploy -- '/var/www/myapp'
~~~

Permissions are omitted with -x because the entry is removed.

Broad removal commands:

~~~bash
setfacl -b -- '/var/www/myapp'
setfacl -k -- '/var/www/myapp'
~~~

- -b removes all extended ACL entries
- -k removes a directory's default ACL
- These broad removals are not currently exposed by the MyRepos GUI

Default/inherited ACL:

~~~bash
setfacl -m d:u:deploy:rwx -- '/var/www/myapp'
~~~

| Part | Meaning |
|---|---|
| d | Default namespace |
| u | User |
| deploy | Named account |
| rwx | Access inherited by new children |

Default ACLs belong to directories.

Recursive:

~~~bash
setfacl -R -m u:deploy:rwX -- '/var/www/myapp'
~~~

| Option | Meaning |
|---|---|
| -R | Recursive |
| -m | Modify/add |
| -x | Remove entries |
| -b | Remove extended ACL |
| -k | Remove default ACL |
| -d | Work on default ACL |
| -n | Do not recalculate mask |
| --mask | Force mask recalculation |
| --restore=FILE | Restore an ACL backup |

Precise directory/file ACL rules:

~~~bash
find '/var/www/myapp' -xdev -type d -exec setfacl -m u:deploy:rwx -- '{}' +
find '/var/www/myapp' -xdev -type f -exec setfacl -m u:deploy:rw- -- '{}' +
find '/var/www/myapp' -xdev -type d -exec setfacl -m d:u:deploy:rwx -- '{}' +
~~~

## 13. umask - defaults for newly created items

chmod changes existing items. umask influences modes of new items.

~~~bash
umask
umask -S
~~~

Common umask 0022:

- Requested file mode 0666 minus mask bits gives 0644
- Requested directory mode 0777 minus mask bits gives 0755

Collaborative umask 0002 commonly produces:

- Files 0664
- Directories 0775

Important:

- umask belongs to a process/session, not a folder
- A service can use a different umask from an SSH shell
- setgid inherits group, not exact mode
- Default ACLs can provide directory-specific inheritance

## 14. readlink and realpath - understand path resolution

Display a link's stored target:

~~~bash
readlink -- '/path/to/link'
~~~

Resolve all components:

~~~bash
readlink -f -- '/path/to/link'
realpath -- '/var/www/../www/myapp'
~~~

Inspect resolved paths before high-impact operations. The entered name can differ from the object ultimately reached.

## 15. namei - diagnose parent access

Access depends on every parent directory:

~~~bash
namei -l -- '/var/www/myapp/storage/file.log'
~~~

namei shows each component with owner/group/mode. A missing execute bit on a parent is a common reason the final file appears correct but remains inaccessible.

## 16. Test access as another user

When authorized:

~~~bash
sudo -u ginipig test -r '/var/www/myapp/file' && echo readable
sudo -u ginipig test -w '/var/www/myapp/file' && echo writable
sudo -u ginipig test -x '/var/www/myapp' && echo traversable
~~~

| Test | Meaning |
|---|---|
| -r | Readable |
| -w | Writable |
| -x | Executable/traversable |
| -e | Exists |
| -f | Regular file |
| -d | Directory |

These reflect effective POSIX access for the test process. Other layers such as SELinux may still affect the real application.

MyRepos rejects sudo text in Command mode and manages privilege elevation internally after validation.

## 17. How the mechanisms interact

Access is evaluated through layers:

1. Path resolution and parent traversal
2. Filesystem and mount state
3. User and group identity
4. Owner/group/other mode bits
5. POSIX ACL and mask
6. Service or container identity
7. SELinux or AppArmor
8. Application rules

A successful chmod does not guarantee application access. A correct ACL does not help when a parent cannot be traversed. Correct ownership does not override a read-only filesystem.

## 18. Real policy examples

### User-managed readable tree

~~~bash
find '/var/ginipig/project' -xdev -exec chown -h 'ginipig:ginipig' -- '{}' +
find '/var/ginipig/project' -xdev -type d -exec chmod 0755 -- '{}' +
find '/var/ginipig/project' -xdev -type f -exec chmod 0644 -- '{}' +
~~~

Result:

- ginipig owns everything
- ginipig can edit
- Others can normally read/traverse
- Ordinary files are not made executable

### Private tree

~~~bash
find '/var/ginipig/private' -xdev -exec chown -h 'ginipig:ginipig' -- '{}' +
find '/var/ginipig/private' -xdev -type d -exec chmod 0700 -- '{}' +
find '/var/ginipig/private' -xdev -type f -exec chmod 0600 -- '{}' +
~~~

Result: only ginipig receives ordinary POSIX access.

### Shared web project

~~~bash
find '/var/www/myapp' -xdev -exec chown -h 'deploy:www-data' -- '{}' +
find '/var/www/myapp' -xdev -type d -exec chmod 2775 -- '{}' +
find '/var/www/myapp' -xdev -type f -exec chmod 0664 -- '{}' +
~~~

Result:

- deploy owns content
- www-data is the collaborating group
- Owner and group can edit
- Directories carry setgid for group inheritance
- Others can read/traverse

### Read-only application with writable runtime

Application:

~~~bash
find '/var/www/myapp' -xdev -exec chown -h 'deploy:www-data' -- '{}' +
find '/var/www/myapp' -xdev -type d -exec chmod 2755 -- '{}' +
find '/var/www/myapp' -xdev -type f -exec chmod 0644 -- '{}' +
~~~

Runtime:

~~~bash
find '/var/www/myapp/writable' -xdev -type d -exec chmod 2770 -- '{}' +
find '/var/www/myapp/writable' -xdev -type f -exec chmod 0660 -- '{}' +
~~~

This keeps writable access narrow instead of making the whole application writable.

### Add one user without changing ownership

~~~bash
find '/srv/project' -xdev -type d -exec setfacl -m u:reviewer:r-x -- '{}' +
find '/srv/project' -xdev -type f -exec setfacl -m u:reviewer:r-- -- '{}' +
~~~

The reviewer can read/traverse while existing ownership remains.

## 19. Safe test procedure

Create a disposable tree:

~~~bash
mkdir -p /var/ginipig/access-test/subfolder
touch /var/ginipig/access-test/example.txt
~~~

Inspect before:

~~~bash
stat -c '%A %a %U:%G %n' -- '/var/ginipig/access-test'
find '/var/ginipig/access-test' -maxdepth 2 -printf '%M %m %u:%g %p\n'
getfacl -p -- '/var/ginipig/access-test'
~~~

In MyRepos:

1. Enter exactly /var/ginipig/access-test.
2. Select a Simple outcome.
3. Confirm owner and group.
4. Preview.
5. Verify the resolved path.
6. Verify the affected count is small.
7. Read every proposed operation.
8. Open Command mode and identify every term using this guide.
9. Apply.
10. Inspect again.

Do not begin with slash, /etc, /usr, /boot, production content, or a mounted backup.

## 20. MyRepos GUI and Command interoperability

The views represent one internal policy:

- **Simple** chooses a human outcome
- **Advanced** edits ownership, modes, ACLs, and scope
- **Command** parses or generates supported commands

Supported Command-mode families:

- chmod
- chown
- chgrp
- setfacl -m
- setfacl -x
- Safe find with -exec and plus

Rejected shell features:

- Pipes
- Redirects
- Semicolons and chaining
- Command substitution
- Arbitrary scripts
- Unrelated executables
- User-supplied sudo

Command mode parses text into a policy. It never runs raw shell text.

### Preview

Preview:

- Resolves the target
- Reads type, owner, group, mode, and ACL
- Counts affected items
- Displays ordered operations
- Classifies risk
- Issues a token valid for 60 seconds

### Apply

Apply:

- Requires the preview token
- Rechecks target identity/state
- Rejects stale or edited previews
- Runs only the validated internal policy

Paths under /proc, /sys, and /dev are blocked. Critical or unusually broad operations require stronger confirmation.

## 21. Troubleshooting by command

### User cannot enter a directory

~~~bash
namei -l -- '/full/path/to/item'
id USER
getfacl -p -- '/full/path/to/item'
~~~

Check execute/traverse on every parent.

### Ownership looks right but write fails

~~~bash
stat -c '%A %a %U:%G %n' -- '/path'
getfacl -p -- '/path'
findmnt -T '/path'
~~~

Check directory mode, ACL mask, parents, mount flags, and read-only state.

### Permissions return after deployment

Inspect the deployment process user and umask. Recreated files receive new ownership/modes. Fix the producing process instead of repeatedly repairing output.

### Web server cannot read content

~~~bash
ps -eo user,group,comm | grep -E 'apache|httpd|nginx|php'
namei -l -- '/var/www/myapp/index.php'
getfacl -p -- '/var/www/myapp/index.php'
~~~

Confirm the real service identity, every parent, ACL mask, and SELinux/AppArmor.

### ACL command is missing

~~~bash
command -v getfacl
command -v setfacl
~~~

Install the operating system's ACL package and confirm filesystem support.

### Find operation is broader than expected

Preview names without executing:

~~~bash
find '/target' -xdev -type d -print
find '/target' -xdev -type f -print
~~~

Add -maxdepth during investigation when appropriate.

## 22. Related commands outside the current GUI

These control different security layers and must not be translated into chmod values:

| Commands | Purpose |
|---|---|
| lsattr, chattr | Filesystem attributes such as immutable |
| getcap, setcap | Executable capabilities |
| ls -Z, restorecon, chcon | SELinux contexts |
| semanage fcontext | Persistent SELinux path rules |
| AppArmor tools | Mandatory access-control profiles |
| NFSv4/SMB ACL tools | Network-filesystem ACL models |
| getfacl/setfacl backup flows | Bulk ACL backup and restore |

Preview reduces mistakes, but it is not a substitute for a server backup.
