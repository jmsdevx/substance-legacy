PROJECT_DIR=$(pwd)

# sanity check: executed in the root folder?
if [ ! -f src/composer.js ]; then
  echo "composer/update.sh must be executed in the root dir of the repository."
fi

##########################
# command line options
#

EXTERNALS=/tmp/substance

function readopts {
  while ((OPTIND<=$#)); do
    if getopts ":d:h" opt; then
      case $opt in
        d) EXTERNALS=$OPTARG;;
    h) echo "Usage: update.sh [-d <directory>]" $$ exit;;
        *) ;;
      esac
    else
        let OPTIND++
    fi
  done
}

OPTIND=1
readopts "$@"

echo "Updating store..."
echo "Storing into directory: $EXTERNALS"

if [ ! -d $EXTERNALS ]; then
  mkdir $EXTERNALS
fi

######################
# boost
cd $EXTERNALS

boost_modules="config detail exception smart_ptr algorithm iterator mpl range type_traits preprocessor utility concept function bind format optional"

if [ ! -d boost ]; then
  svn co --depth files http://svn.boost.org/svn/boost/tags/release/Boost_1_50_0/boost
  cd boost
  svn update $boost_modules
fi

######################
# jsobjects
cd $EXTERNALS

if [ ! -d jsobjects ]; then
  git clone https://github.com/oliver----/jsobjects.git
fi

cd jsobjects
./update.sh -d $EXTERNALS -v

######################
# redis store
cd $EXTERNALS

if [ ! -d store ]; then
  git clone git@github.com:substance/store.git
fi

cd store
./update.sh -d $EXTERNALS -b -e jsc

######################
# redis server
cd $EXTERNALS

if [ ! -d redis ]; then
  git clone https://github.com/antirez/redis.git
  git checkout 2.6.6
fi

cd redis
if [ ! -f redis-server ]; then
	make
	make PREFIX=$EXTERNALS/redis install
fi

#######################
# Build Substance
echo "Building Substance ..."

cd $PROJECT_DIR
if [ ! -d build ]; then
	mkdir build
fi
cd build
cmake -DEXTERNALS_DIR=$EXTERNALS -DCMAKE_PREFIX_PATH=$EXTERNALS ..
make
