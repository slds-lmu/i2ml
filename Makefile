.PHONY: publish

all: clean publish

publish:
	git worktree add public gh-pages
	hugo
	cd public; git add --all; git commit -m "Publish via makefile"; git push origin gh-pages --force
	rm -rf public
	git worktree prune

clean:
	rm -rf public
	git worktree prune

update_theme:
	git submodule update --recursive --remote
	git add themes/courseTheme
	git commit -m "update theme"

watch: clean; hugo server -D